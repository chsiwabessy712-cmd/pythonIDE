import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from "@monaco-editor/react";
import { Play, Square, CheckCircle, AlertCircle, Code, FileText, Lock, Award, Move, Plus, Edit2, X, ChevronLeft, ChevronRight, ChevronDown, Trash2, Save } from 'lucide-react';
import { doc, getDoc, setDoc, collection, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, useAppState } from '../../context/AppStateContext';
import { Button } from './Button';
import { ErrorBoundary } from './ErrorBoundary';
import { sanitizeHtml } from './sanitizeHtml';
import { playSound } from './feedbackSound';
import { TurtlePanel, TurtleStream } from './TurtleCanvas';
import { ZoomableHtml } from './ImageViewer';

// Suppress ResizeObserver errors (caused by Monaco Editor)
if (typeof window !== 'undefined') {
    const resizeObserverErr = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
        if (message && message.includes && message.includes('ResizeObserver')) {
            return true; // Suppress the error
        }
        return resizeObserverErr ? resizeObserverErr(message, source, lineno, colno, error) : false;
    };
}

// Python code execution using Pyodide Web Worker (runs on separate thread)
// The worker file is at public/pythonWorker.js

// Starter templates are stored with guide comments ("# Write your code here",
// "# Call the function", ...). The editor shows only their code: comments are
// cut, comment-only lines dropped and blank runs squeezed to one line. A '#'
// inside a string literal is code and stays.
const stripComments = (template) => {
    const lines = [];
    let quote = null; // an open triple-quoted string carries over to the next line
    for (const line of template.split('\n')) {
        let code = '';
        let hadComment = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quote) {
                if (ch === '\\') {
                    code += ch + (line[i + 1] ?? '');
                    i++;
                } else if (line.startsWith(quote, i)) {
                    code += quote;
                    i += quote.length - 1;
                    quote = null;
                } else {
                    code += ch;
                }
            } else if (ch === '#') {
                hadComment = true;
                break;
            } else if (ch === '"' || ch === "'") {
                quote = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
                code += quote;
                i += quote.length - 1;
            } else {
                code += ch;
            }
        }
        if (quote && quote.length === 1) quote = null;
        if (hadComment) {
            code = code.trimEnd();
            if (!code) continue;
        }
        lines.push(code);
    }

    const kept = [];
    for (const line of lines) {
        const blank = !line.trim();
        if (blank && (kept.length === 0 || !kept[kept.length - 1])) continue;
        kept.push(blank ? '' : line);
    }
    while (kept.length && !kept[kept.length - 1]) kept.pop();
    return kept.length ? kept.join('\n') + '\n' : '';
};

const validateCodeRequirements = (code, requirements) => {
    if (!requirements) return { valid: true, issues: [] };

    const issues = [];

    // Judge only the code itself: starter templates ship several comment lines,
    // which would otherwise count towards maxLines and could contain a
    // forbidden word or satisfy a required one.
    const codeLines = code.split('\n').filter(line => line.trim().length > 0 && !line.trim().startsWith('#'));
    const codeText = codeLines.join('\n');

    // Match a pattern as plain text first, then as a regex. Many stored patterns
    // are literal code such as print('7') or .zfill(2), whose regex meaning
    // ("print'7'", "zfill2") never appears in real code.
    const testPattern = (pattern, text) => {
        if (!pattern || pattern.trim() === '') return true;
        if (text.toLowerCase().includes(pattern.toLowerCase())) return true;
        try {
            const regex = new RegExp(pattern, 'i');
            return regex.test(text);
        } catch (e) {
            return false;
        }
    };

    // Check must-have patterns
    if (requirements.mustHave) {
        requirements.mustHave.forEach(pattern => {
            if (pattern && pattern.trim() !== '' && !testPattern(pattern, codeText)) {
                issues.push(`Code must use: ${pattern}`);
            }
        });
    }

    // Check forbidden patterns
    if (requirements.mustNotHave) {
        requirements.mustNotHave.forEach(pattern => {
            if (pattern && pattern.trim() !== '' && testPattern(pattern, codeText)) {
                issues.push(`Code should not use: ${pattern}`);
            }
        });
    }

    // Check line count (comment lines don't count)
    if (requirements.minLines && codeLines.length < requirements.minLines) {
        issues.push(`Code should have at least ${requirements.minLines} lines of code`);
    }
    if (requirements.maxLines && codeLines.length > requirements.maxLines) {
        issues.push(`Code should have at most ${requirements.maxLines} lines of code`);
    }

    // Check minimum variables (count variable assignments like: varName = value or n1,n2 = value)
    if (requirements.minVariables && requirements.minVariables > 0) {
        // Count individual variable names on the left side of assignments
        // Match lines with = (but not ==, !=, <=, >=)
        const assignmentLines = code.split('\n').filter(line => {
            const trimmed = line.trim();
            // Skip comments and lines without =
            if (trimmed.startsWith('#') || !trimmed.includes('=')) return false;
            // Check it's an assignment (not comparison)
            return /[^=!<>]=[^=]/.test(trimmed);
        });
        
        let variableCount = 0;
        assignmentLines.forEach(line => {
            // Get the left side of the assignment
            const leftSide = line.split('=')[0].trim();
            // Count variable names (handles: x, n1,n2, a,b,c, etc.)
            const varNames = leftSide.split(',').map(v => v.trim()).filter(v => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v));
            variableCount += varNames.length;
        });
        
        if (variableCount < requirements.minVariables) {
            issues.push(`Code must have at least ${requirements.minVariables} variable(s). Found: ${variableCount}`);
        }
    }

    return {
        valid: issues.length === 0,
        issues
    };
};

const FileModal = ({ isOpen, onClose, onSave, initialName = "", initialContent = "" }) => {
    const [filename, setFilename] = useState(initialName);
    const [content, setContent] = useState(initialContent);

    React.useEffect(() => {
        setFilename(initialName);
        setContent(initialContent);
    }, [initialName, initialContent, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-xl shadow-2xl w-[600px] flex flex-col overflow-hidden border border-slate-200">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                        <FileText size={20} className="text-blue-600" /> {initialName ? 'Edit File' : 'New File'}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Filename</label>
                        <input type="text" value={filename} onChange={e => setFilename(e.target.value)} placeholder="e.g. data.txt" className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm" disabled={!!initialName} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Content</label>
                        <textarea value={content} onChange={e => setContent(e.target.value)} className="w-full h-48 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm resize-none" placeholder="Type file content here..." />
                    </div>
                </div>
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg font-medium transition-colors">Cancel</button>
                    <button onClick={() => onSave(filename, content)} disabled={!filename.trim()} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">Save File</button>
                </div>
            </div>
        </div>
    );
};

// Memoized Sidebar Component (kept for potential future use)
// eslint-disable-next-line no-unused-vars
const QuestionsSidebar = React.memo(({
    levelName,
    questions,
    currentQuestionIndex,
    completedQuestions,
    revisionsNeeded,
    sidebarTab,
    setSidebarTab,
    userFiles,
    currentUser,
    levelId,
    setCompletedQuestions,
    setCurrentQuestionIndex,
    setCode,
    setOutput,
    setFeedback,
    setAttemptCounts,
    openNewFileModal,
    openEditFileModal,
    deleteFile,
    goToQuestion,
    isQuestionUnlocked
}) => {
    const progress = Math.round((completedQuestions.length / questions.length) * 100);

    return (
        <div className="w-64 bg-slate-900 text-white flex flex-col border-r border-slate-700">
            <div className="p-4 border-b border-slate-800">
                {/* Home Button */}
                <button
                    onClick={() => {
                        // Try to close the window first (works if opened via JS)
                        window.close();
                        // Fallback: remove portalLevelId and reload to go back to main app
                        setTimeout(() => {
                            const url = new URL(window.location.href);
                            url.searchParams.delete('portalLevelId');
                            window.location.href = url.toString();
                        }, 100);
                    }}
                    className="mb-4 flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-sm w-full">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                        <polyline points="9 22 9 12 15 12 15 22"></polyline>
                    </svg>
                    Home
                </button>

                <h2 className="text-xl font-bold mb-2 truncate">{levelName}</h2>

                {/* Tabs */}
                <div className="flex bg-slate-800 rounded-lg p-1 mt-4">
                    <button
                        onClick={() => setSidebarTab('questions')}
                        className={`flex-1 py-1 text-xs font-bold rounded-md transition-colors ${sidebarTab === 'questions' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                        Questions
                    </button>
                    <button
                        onClick={() => setSidebarTab('files')}
                        className={`flex-1 py-1 text-xs font-bold rounded-md transition-colors ${sidebarTab === 'files' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                        Files
                    </button>
                </div>
            </div>

            <div className="flex-grow overflow-y-auto p-4 space-y-2">
                {sidebarTab === 'questions' ? (
                    <>
                        {currentUser?.role === 'teacher' && (
                            <div className="mb-4">
                                <div className="text-sm text-slate-400">
                                    Progress: {completedQuestions.length}/{questions.length}
                                </div>
                                <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
                                    <div
                                        className="bg-emerald-500 h-2 rounded-full transition-all"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                                {/* Reset Progress Button */}
                                <button
                                    onClick={async () => {
                                        if (window.confirm('Reset all progress for this level? This cannot be undone.')) {
                                            try {
                                                await setDoc(
                                                    doc(db, 'teachers', currentUser.id, 'progress', levelId),
                                                    { completedQuestions: [], percentage: 0, lastUpdated: new Date() }
                                                );
                                                setCompletedQuestions([]);
                                                setCurrentQuestionIndex(0);
                                                setCode(questions[0]?.codeTemplate || '');
                                                setOutput('');
                                                setFeedback(null);
                                                setAttemptCounts({});
                                                alert('Progress reset successfully!');
                                            } catch (error) {
                                                console.error('Error resetting:', error);
                                                alert('Failed to reset progress');
                                            }
                                        }
                                    }}
                                    className="mt-2 w-full text-xs px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-white transition-colors">
                                    Reset Progress
                                </button>
                            </div>
                        )}

                        {questions.map((q, index) => {
                            const unlocked = isQuestionUnlocked(index);
                            const completed = completedQuestions.includes(q.id);
                            const needsRevision = revisionsNeeded.includes(q.id);
                            const isCurrent = index === currentQuestionIndex;

                            return (
                                <button
                                    key={q.id}
                                    onClick={() => unlocked && goToQuestion(index)}
                                    disabled={!unlocked}
                                    className={`w-full text-left p-3 rounded-lg transition-all ${isCurrent
                                        ? 'bg-violet-600 text-white'
                                        : needsRevision
                                            ? 'bg-amber-900/30 text-amber-400 border border-amber-700'
                                            : completed
                                                ? 'bg-emerald-900/30 text-emerald-400'
                                                : unlocked
                                                    ? 'bg-slate-800 hover:bg-slate-700 text-white'
                                                    : 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                        }`}>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-shrink-0">
                                            {needsRevision ? (
                                                <AlertCircle size={16} />
                                            ) : completed ? (
                                                <CheckCircle size={16} />
                                            ) : unlocked ? (
                                                <Code size={16} />
                                            ) : (
                                                <Lock size={16} />
                                            )}
                                        </div>
                                        <div className="flex-grow min-w-0">
                                            <div className="text-xs font-semibold truncate">
                                                Q{index + 1}: {q.title}
                                            </div>
                                            {needsRevision && (
                                                <div className="text-xs opacity-75">
                                                    Needs Revision
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </>
                ) : (
                    <div>
                        <button onClick={openNewFileModal} className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2 px-4 rounded-lg text-sm font-bold flex items-center justify-center gap-2 mb-4 transition-colors">
                            <Plus size={16} /> New File
                        </button>

                        {/* File I/O Help */}
                        <div className="mb-4 p-3 bg-blue-900/30 rounded-lg border border-blue-700/50">
                            <p className="text-xs text-blue-300 mb-2 font-medium">📁 File I/O Examples:</p>
                            <pre className="text-xs text-blue-200 font-mono whitespace-pre-wrap">{`# Write to file
with open('data.txt', 'w') as f:
    f.write('Hello!')

# Read from file
with open('data.txt', 'r') as f:
    content = f.read()
    print(content)`}</pre>
                        </div>

                        {userFiles.length === 0 ? (
                            <div className="text-center text-slate-500 text-sm italic py-4">No files created yet.</div>
                        ) : (
                            <div className="space-y-2">
                                {userFiles.map(file => (
                                    <div key={file.name} className="group flex items-center justify-between p-3 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors border border-transparent hover:border-slate-600">
                                        <div
                                            className="flex items-center gap-3 overflow-hidden flex-1 cursor-pointer"
                                            onClick={() => openEditFileModal(file)}
                                        >
                                            <FileText size={18} className="text-blue-400 flex-shrink-0" />
                                            <div className="overflow-hidden">
                                                <span className="text-sm text-slate-300 truncate block">{file.name}</span>
                                                <span className="text-xs text-slate-500">{file.content?.length || 0} chars</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => openEditFileModal(file)}
                                                className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-slate-600 rounded transition-colors"
                                                title="Edit file"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm(`Delete "${file.name}"?`)) {
                                                        deleteFile(file.name);
                                                    }
                                                }}
                                                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-600 rounded transition-colors"
                                                title="Delete file"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

// Memoized TaskPanel Component
const TaskPanel = React.memo(({
    currentQuestion,
    currentQuestionIndex,
    isCompleted,
    needsRevision,
    feedback,
    attemptCount = 0
}) => {
    return (
        <div className="w-96 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 overflow-y-auto select-none">
            <div className="p-6 space-y-6">
                <div className="select-none">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                        Question {currentQuestionIndex + 1}
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white">
                        {currentQuestion?.title}
                    </h2>
                </div>

                {needsRevision && (
                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg">
                        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 mb-2">
                            <AlertCircle size={20} />
                            <span className="font-bold text-sm">Revision Requested</span>
                        </div>
                        <p className="text-amber-700 dark:text-amber-300 text-sm">
                            Your previous submission needs revision. Please review the admin feedback and resubmit your improved code.
                        </p>
                    </div>
                )}

                {isCompleted && !needsRevision && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2">
                        <CheckCircle className="text-emerald-600 dark:text-emerald-400" size={20} />
                        <span className="text-emerald-800 dark:text-emerald-200 text-sm font-medium">
                            Completed
                        </span>
                    </div>
                )}

                <div className="prose dark:prose-invert prose-sm max-w-none">
                    <ZoomableHtml html={sanitizeHtml(currentQuestion?.instructions)} />
                </div>

                {currentQuestion?.hints && (isCompleted || attemptCount >= 3) && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200 mb-2">
                            <AlertCircle size={16} />
                            <span className="font-semibold text-sm">Hint</span>
                        </div>
                        <p className="text-blue-700 dark:text-blue-300 text-sm">
                            {currentQuestion.hints}
                        </p>
                    </div>
                )}

                {feedback && (
                    <div
                        className={`p-4 rounded-lg border ${feedback.type === 'success'
                            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                            }`}>
                        <div
                            className={`font-semibold mb-2 ${feedback.type === 'success'
                                ? 'text-emerald-800 dark:text-emerald-200'
                                : 'text-red-800 dark:text-red-200'
                                }`}>
                            {feedback.message}
                        </div>
                        {feedback.details && (
                            <pre
                                className={`text-xs whitespace-pre-wrap ${feedback.type === 'success'
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : 'text-red-700 dark:text-red-300'
                                    }`}>
                                {feedback.details}
                            </pre>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

export const PythonAssessment = ({ levelId, initialQuestionIndex = 0 }) => {
    const { currentUser: contextUser, clearCache } = useAppState();
    // Get the latest user data from localStorage (may have been updated by PortalLevelRunner)
    const currentUser = React.useMemo(() => {
        const savedUser = localStorage.getItem('currentUser');
        if (savedUser) {
            const parsed = JSON.parse(savedUser);
            // Merge with context user, preferring localStorage for id and assignedLevels
            return { ...contextUser, ...parsed };
        }
        return contextUser;
    }, [contextUser]);

    const [level, setLevel] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(initialQuestionIndex);
    const [code, setCode] = useState('');
    const [previewSnippet, setPreviewSnippet] = useState(null);
    const [saving, setSaving] = useState(false);

    // Check for preview mode
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('previewMode') === 'true') {
            const snippetData = sessionStorage.getItem('previewSnippet');
            if (snippetData) {
                const snippet = JSON.parse(snippetData);
                setPreviewSnippet(snippet);
                if (snippet.code) {
                    setCode(snippet.code);
                }
            }
        }
    }, []);

    // Jump to specific question for preview mode
    useEffect(() => {
        if (previewSnippet && questions.length > 0) {
            const levelIdStr = level?.id || previewSnippet.levelId || '';
            const rawSnippetId = previewSnippet.id || '';
            const cleanSnippetId = (levelIdStr && rawSnippetId.startsWith(levelIdStr + '_'))
                ? rawSnippetId.substring(levelIdStr.length + 1)
                : rawSnippetId;

            let index = -1;
            if (cleanSnippetId) {
                index = questions.findIndex(q => {
                    const qIdClean = (q.id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
                    const targetClean = cleanSnippetId.replace(/[^a-zA-Z0-9_-]/g, '_');
                    return qIdClean === targetClean || q.id === cleanSnippetId;
                });
            }

            if (index === -1 && previewSnippet.challengeId) {
                const stepId = previewSnippet.ackKey?.includes('--') ? previewSnippet.ackKey.split('--')[1] : (previewSnippet.stepId || null);
                const targetChallengeId = stepId ? `${previewSnippet.challengeId}_step_${stepId}` : previewSnippet.challengeId;
                index = questions.findIndex(q => 
                    q.id === targetChallengeId || 
                    q.challengeId === previewSnippet.challengeId ||
                    q.id === previewSnippet.challengeId ||
                    (q.id && q.id.includes('_step_') && q.id.split('_step_')[0] === previewSnippet.challengeId)
                );
            }

            if (index === -1 && previewSnippet.unitName && previewSnippet.title) {
                index = questions.findIndex(q => 
                    (q.unitName || '').toLowerCase() === previewSnippet.unitName.toLowerCase() &&
                    (q.title || '').toLowerCase() === previewSnippet.title.toLowerCase()
                );
            }

            if (index === -1 && previewSnippet.title) {
                index = questions.findIndex(q => 
                    (q.title || '').toLowerCase() === previewSnippet.title.toLowerCase()
                );
            }

            if (index !== -1) {
                setCurrentQuestionIndex(index);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewSnippet, questions.length]);
    const [output, setOutput] = useState('');

    // Console height in px, set by dragging the bar above it and remembered in
    // this browser. The console never grows past the column minus
    // CONSOLE_EDITOR_RESERVE, which keeps the toolbar and some editor visible.
    const CONSOLE_DEFAULT_HEIGHT = 192;
    const CONSOLE_MIN_HEIGHT = 80;
    const CONSOLE_EDITOR_RESERVE = 160;
    const CONSOLE_HEIGHT_KEY = 'pythonConsoleHeight';
    const editorColumnRef = useRef(null);
    const [consoleHeight, setConsoleHeight] = useState(() => {
        try {
            const saved = Number(localStorage.getItem(CONSOLE_HEIGHT_KEY));
            if (saved >= CONSOLE_MIN_HEIGHT) return saved;
        } catch { /* storage blocked: use the default */ }
        return CONSOLE_DEFAULT_HEIGHT;
    });
    useEffect(() => {
        try { localStorage.setItem(CONSOLE_HEIGHT_KEY, String(consoleHeight)); } catch { /* not remembered */ }
    }, [consoleHeight]);
    const clampConsoleHeight = (height) => {
        const column = editorColumnRef.current?.getBoundingClientRect().height || window.innerHeight;
        const max = Math.max(CONSOLE_MIN_HEIGHT, column - CONSOLE_EDITOR_RESERVE);
        return Math.round(Math.min(max, Math.max(CONSOLE_MIN_HEIGHT, height)));
    };
    const startConsoleResize = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const handle = e.currentTarget;
        const startY = e.clientY;
        const startHeight = consoleHeight;
        const onMove = (ev) => setConsoleHeight(clampConsoleHeight(startHeight + startY - ev.clientY));
        const onEnd = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onEnd);
            handle.removeEventListener('pointercancel', onEnd);
            document.body.style.userSelect = '';
        };
        handle.setPointerCapture(e.pointerId);
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onEnd);
        handle.addEventListener('pointercancel', onEnd);
        document.body.style.userSelect = 'none';
    };
    const onConsoleResizeKey = (e) => {
        const step = e.shiftKey ? 96 : 24;
        if (e.key === 'ArrowUp') setConsoleHeight(clampConsoleHeight(consoleHeight + step));
        else if (e.key === 'ArrowDown') setConsoleHeight(clampConsoleHeight(consoleHeight - step));
        else return;
        e.preventDefault();
    };

    const [isRunning, setIsRunning] = useState(false);
    const [completedQuestions, setCompletedQuestions] = useState([]);
    const [revisionsNeeded, setRevisionsNeeded] = useState([]);
    const [feedback, setFeedback] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingStage, setLoadingStage] = useState({ pct: 0, label: 'Initializing…' });
    const [loadingQuestion, setLoadingQuestion] = useState(false);
    const [attemptCounts, setAttemptCounts] = useState({});
    const [savedSubmissions, setSavedSubmissions] = useState({}); // Map of questionId -> { code, output }
    const [isLoadedFromSubmission, setIsLoadedFromSubmission] = useState(false);
    
    // True while an answer is being checked, so Submit can't be pressed twice
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);

    // Submission Comment State
    const [submissionComment, setSubmissionComment] = useState("");
    const [showCommentModal, setShowCommentModal] = useState(false);
    const [pendingAdvance, setPendingAdvance] = useState(null);

    // Turtle: the worker's turtle commands stream into turtleStream while the
    // program runs (TurtleCanvas.js), and a window over the editor shows them.
    // turtleView: 'open', 'closed' (hidden, but there's a drawing) or 'none'
    const [turtleStream] = useState(() => new TurtleStream());
    const [turtleView, setTurtleView] = useState('none');
    const [turtleCatchUp, setTurtleCatchUp] = useState(false);
    const turtleModeRef = useRef('run'); // 'run', 'replay' (re-run after an input) or 'submit'
    const turtleAutoOpenRef = useRef(false); // open the panel on this run's first command
    const turtleRunsRef = useRef([]); // Submit: the commands of each graded run

    // A run that drew nothing has no turtle panel
    const hideEmptyTurtle = () => {
        if (turtleStream.commands.length === 0) setTurtleView('none');
    };

    // After Submit: the drawing of the first test case that failed, or else of
    // the last one
    const showGradedTurtle = (runIndex) => {
        const runs = turtleRunsRef.current;
        const commands = runs[runIndex] ?? runs[runs.length - 1];
        if (!commands?.length) return;
        turtleStream.load(commands);
        setTurtleCatchUp(false);
        setTurtleView('open');
    };

    // File IO State
    const [userFiles, setUserFiles] = useState([]);
    const [fileModalOpen, setFileModalOpen] = useState(false);
    const [editingFile, setEditingFile] = useState(null);
    const [sidebarTab, setSidebarTab] = useState('questions');
    const [showCongratulations, setShowCongratulations] = useState(false);

    // Web Worker State
    const workerRef = useRef(null);
    const workerReadyRef = useRef(false);
    const runResolveRef = useRef(null); // Promise resolve for runCode
    const collectedInputsRef = useRef([]); // Accumulated inputs for re-execution
    const currentCodeRef = useRef(''); // Code being executed
    const runSeedRef = useRef(null); // Random seed shared by every re-execution of one Run
    const [inputRequest, setInputRequest] = useState(null); // { prompt } when Python needs input
    const [inputValue, setInputValue] = useState('');

    // Hard cap on visible output to keep React from re-rendering megabytes
    // of text (which is what makes the tab freeze when student code prints
    // inside an infinite loop). The worker also enforces a stricter Python-
    // side cap; this is the last line of defence.
    const MAX_OUTPUT_CHARS = 200_000;
    const capOutput = (text) => {
        if (typeof text !== 'string') return text;
        if (text.length <= MAX_OUTPUT_CHARS) return text;
        return (
            text.slice(0, MAX_OUTPUT_CHARS) +
            `\n\n[Output truncated at ${MAX_OUTPUT_CHARS / 1000} KB to keep the page responsive.]`
        );
    };

    // Watchdog: if the worker stops responding (e.g. user code disables the
    // trace, or a single chunk between yields runs longer than expected),
    // terminate and recreate it so the UI never gets stuck on "Running…".
    const WATCHDOG_MS = 65_000; // slightly longer than worker's 60s total cap
    const watchdogRef = useRef(null);
    const armWatchdog = useCallback(() => {
        if (watchdogRef.current) clearTimeout(watchdogRef.current);
        watchdogRef.current = setTimeout(() => {
            // Worker hasn't reported done/error in time — kill it.
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
                workerReadyRef.current = false;
            }
            setIsRunning(false);
            setInputRequest(null);
            setOutput((prev) =>
                (prev || '') +
                '\n[Stopped automatically: program ran longer than the safety timeout. ' +
                'Check for infinite loops.]'
            );
            if (runResolveRef.current) {
                runResolveRef.current(null);
                runResolveRef.current = null;
            }
            // Recreate the worker so the next Run still works.
            createWorkerRef.current && createWorkerRef.current();
        }, WATCHDOG_MS);
    }, []);
    const disarmWatchdog = useCallback(() => {
        if (watchdogRef.current) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
    }, []);
    // Forward-declare ref so armWatchdog can recreate the worker without a
    // useCallback cycle.
    const createWorkerRef = useRef(null);

    // ── Web Worker: create & manage ──
    const createWorker = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.terminate();
        }
        const worker = new Worker('/pythonWorker.js');
        worker.onmessage = (e) => {
            const msg = e.data;
            switch (msg.type) {
                case 'loading':
                    // Optionally update a secondary loading indicator
                    break;
                case 'ready':
                    workerReadyRef.current = true;
                    break;
                case 'output':
                    setOutput(capOutput(msg.text));
                    break;
                case 'input_request':
                    // Python needs user input — show inline input field
                    setOutput(capOutput(msg.outputSoFar || ''));
                    setInputRequest({ prompt: '' });
                    disarmWatchdog();
                    hideEmptyTurtle();
                    break;
                case 'done':
                    setOutput(capOutput(msg.output));
                    setIsRunning(false);
                    setInputRequest(null);
                    disarmWatchdog();
                    hideEmptyTurtle();
                    // Sync files after run
                    worker.postMessage({ type: 'sync_files' });
                    // Resolve runCode promise
                    if (runResolveRef.current) {
                        runResolveRef.current(msg.output);
                        runResolveRef.current = null;
                    }
                    break;
                case 'error':
                    const errorMsg = msg.message || 'Error running code';
                    setOutput(capOutput(`Error: ${errorMsg}`));
                    setIsRunning(false);
                    setInputRequest(null);
                    disarmWatchdog();
                    hideEmptyTurtle();
                    setFeedback({
                        type: 'error',
                        message: 'Code has errors. Please fix and try again.',
                        details: errorMsg
                    });
                    // Resolve runCode promise with null on error
                    if (runResolveRef.current) {
                        runResolveRef.current(null);
                        runResolveRef.current = null;
                    }
                    break;
                case 'turtle': {
                    const cmd = msg.command;
                    if (turtleModeRef.current === 'submit') {
                        // Kept per graded run; Submit shows one when it's done
                        if (cmd.action === 'begin') turtleRunsRef.current.push([]);
                        else turtleRunsRef.current[turtleRunsRef.current.length - 1]?.push(cmd);
                    } else if (cmd.action === 'begin') {
                        if (turtleModeRef.current === 'replay') {
                            turtleStream.replay();
                        } else {
                            turtleStream.reset();
                            turtleAutoOpenRef.current = true;
                        }
                    } else {
                        turtleStream.push(cmd);
                        if (turtleAutoOpenRef.current) {
                            turtleAutoOpenRef.current = false;
                            setTurtleCatchUp(false);
                            setTurtleView('open');
                        }
                    }
                    break;
                }
                case 'files':
                    setUserFiles(msg.files || []);
                    break;
                default:
                    break;
            }
        };
        worker.onerror = (err) => {
            console.error('Worker error:', err);
            setIsRunning(false);
            setInputRequest(null);
            disarmWatchdog();
        };
        workerRef.current = worker;
        worker.postMessage({ type: 'init' });
        return worker;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep a ref-pointer to createWorker so the watchdog (declared above)
    // can recreate it after a forced terminate.
    useEffect(() => {
        createWorkerRef.current = createWorker;
    }, [createWorker]);

    // Initialize worker on mount
    useEffect(() => {
        createWorker();
        return () => {
            if (workerRef.current) workerRef.current.terminate();
            if (watchdogRef.current) clearTimeout(watchdogRef.current);
        };
    }, [createWorker]);

    // File operations via worker
    const syncFiles = () => {
        if (workerRef.current) workerRef.current.postMessage({ type: 'sync_files' });
    };

    const saveFile = (name, content) => {
        if (workerRef.current) workerRef.current.postMessage({ type: 'save_file', name, content });
        setFileModalOpen(false);
    };

    const deleteFile = (name) => {
        if (workerRef.current) workerRef.current.postMessage({ type: 'delete_file', name });
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [levelId, currentUser]);

    const loadData = async () => {
        try {
            // Stage 1 — Level info
            setLoadingStage({ pct: 10, label: 'Loading level information…' });
            const levelDoc = await getDoc(doc(db, 'codingLevels', levelId));
            if (levelDoc.exists()) {
                setLevel({ id: levelDoc.id, ...levelDoc.data() });
            }

            // Stage 2 — Curriculum structure
            setLoadingStage({ pct: 25, label: 'Loading curriculum structure…' });
            const unitsRef = collection(db, 'codingLevels', levelId, 'units_new');
            const unitsSnap = await getDocs(unitsRef);

            const unitsSorted = unitsSnap.docs
                .map(d => ({ ref: d.ref, id: d.id, ...d.data() }))
                .sort((a, b) => parseInt(a.unitNumber || 0) - parseInt(b.unitNumber || 0));

            const allQuestions = [];
            let order = 0;

            for (const unitDoc of unitsSorted) {
                const unitData = unitDoc;
                const challengesRef = collection(unitDoc.ref, 'challenges');
                const challengesSnap = await getDocs(challengesRef);
                
                const challengesSorted = challengesSnap.docs
                    .map(d => ({ ref: d.ref, id: d.id, ...d.data() }))
                    .sort((a, b) => (parseFloat(a.orderIndex) || 0) - (parseFloat(b.orderIndex) || 0));

                for (const challengeDoc of challengesSorted) {
                    const challengeData = challengeDoc;

                    // Load steps for this challenge
                    const stepsRef = collection(challengeDoc.ref, 'steps');
                    const stepsSnap = await getDocs(stepsRef);

                    // Filter only hard difficulty steps.
                    // Tiebreak by doc id so numbering is deterministic even
                    // when stepIndex is missing/duplicated — otherwise the
                    // "Step N" label depends on Firestore's arbitrary fetch
                    // order and a step can be numbered differently across
                    // sessions (e.g. a "Step 3" submission showing as "Step 1").
                    const hardSteps = stepsSnap.docs
                        .map(stepDoc => ({ id: stepDoc.id, ...stepDoc.data() }))
                        .filter(step => step.difficulty === 'hard')
                        .sort((a, b) =>
                            (a.stepIndex || 0) - (b.stepIndex || 0) ||
                            String(a.id).localeCompare(String(b.id))
                        );

                    // Create a question for each hard step
                    for (let stepIdx = 0; stepIdx < hardSteps.length; stepIdx++) {
                        const step = hardSteps[stepIdx];
                        allQuestions.push({
                            id: `${challengeDoc.id}_step_${step.id}`,
                            challengeId: challengeDoc.id,
                            unitId: unitDoc.id,
                            stepId: step.id,
                            title: `${challengeData.challengeName} - Step ${stepIdx + 1}`,
                            instructions: step.content || challengeData.description || '',
                            expectedOutput: step.expectedOutput || challengeData.expectedOutput || '',
                            codeTemplate: stripComments(step.starterCode || challengeData.starterCode || ''),
                            hints: step.hint || challengeData.hint || '',
                            testCases: step.testCases || [],
                            validationScript: step.validationScript || challengeData.validationScript || '',
                            order: order++,
                            stepIndex: step.stepIndex || stepIdx,
                            requirements: step.requirements || challengeData.requirements || {
                                mustHave: [],
                                mustNotHave: [],
                                minLines: 0,
                                maxLines: 0
                            },
                            unitName: unitData.unitName,
                            unitNumber: unitData.unitNumber
                        });
                    }
                }
            }

            // Stage 3 — Questions sorted
            setLoadingStage({ pct: 55, label: 'Building questions list…' });
            // Sort by order
            allQuestions.sort((a, b) => (a.order || 0) - (b.order || 0));
            setQuestions(allQuestions);

            // Stage 4 — Progress & revisions
            setLoadingStage({ pct: 70, label: 'Loading your progress…' });
            const params = new URLSearchParams(window.location.search);
            const urlQuestionIndex = params.get('questionIndex');
            // The question to open first, so the editor can be filled with that
            // question's code: the ?questionIndex= one, or where a teacher left off
            let startIndex = Math.max(0, Math.min(initialQuestionIndex, allQuestions.length - 1));
            let loadedCompletedQuestions = [];
            if (currentUser?.role === 'teacher' && currentUser.id) {
                const progressDoc = await getDoc(
                    doc(db, 'teachers', currentUser.id, 'progress', levelId)
                );
                if (progressDoc.exists()) {
                    loadedCompletedQuestions = progressDoc.data().completedQuestions || [];
                    setCompletedQuestions(loadedCompletedQuestions);

                    // Auto-jump to the first incomplete question (resume progress)
                    // Only if not coming from a specific questionIndex in URL
                    if (!urlQuestionIndex && loadedCompletedQuestions.length > 0) {
                        // Find the first incomplete question
                        const firstIncompleteIndex = allQuestions.findIndex(
                            q => !loadedCompletedQuestions.includes(q.id)
                        );

                        if (firstIncompleteIndex > 0) {
                            startIndex = firstIncompleteIndex;
                        } else if (firstIncompleteIndex === -1 && allQuestions.length > 0) {
                            // All completed - go to last question
                            startIndex = allQuestions.length - 1;
                        }
                    }
                }

                // A ?questionIndex= link can't open a question that is still
                // locked: go to the first one not yet passed instead
                if (startIndex > 0 && !loadedCompletedQuestions.includes(allQuestions[startIndex - 1]?.id)) {
                    startIndex = allQuestions.findIndex(q => !loadedCompletedQuestions.includes(q.id));
                }

                // Load revision statuses from acknowledgements
                const revisionsNeededList = [];
                for (const question of allQuestions) {
                    if (question.challengeId && question.unitId) {
                        const challengeRef = doc(
                            db,
                            'codingLevels',
                            levelId,
                            'units_new',
                            question.unitId,
                            'challenges',
                            question.challengeId
                        );
                        const challengeSnap = await getDoc(challengeRef);
                        if (challengeSnap.exists()) {
                            const challengeData = challengeSnap.data();
                            // Check for new key first
                            const ackKey = `${currentUser.username.toLowerCase()}--${question.stepId}`;
                            let ack = challengeData.acknowledgements?.[ackKey];

                            // Fallback to legacy key if not found
                            if (!ack) {
                                ack = challengeData.acknowledgements?.[currentUser.username.toLowerCase()];
                            }

                            if (ack?.status === 'needs_revision') {
                                revisionsNeededList.push(question.id);
                            }
                        }
                    }
                }
                setRevisionsNeeded(revisionsNeededList);
            }

            // Stage 5 — Previous submissions
            setLoadingStage({ pct: 88, label: 'Loading previous submissions…' });
            const submissionsMap = {};
            if (currentUser?.username) {
                try {
                    const submissionsRef = collection(db, 'users', currentUser.username.toLowerCase(), 'submissions');
                    const submissionsSnap = await getDocs(submissionsRef);
                    submissionsSnap.docs.forEach(subDoc => {
                        const subData = subDoc.data();
                        // Match submissions by their ID pattern: {levelId}_{questionId}
                        if (subDoc.id.startsWith(levelId + '_')) {
                            // Extract the question portion of the ID
                            const questionIdPart = subDoc.id.substring(levelId.length + 1);
                            submissionsMap[questionIdPart] = {
                                code: subData.code,
                                output: subData.actualOutput,
                                timestamp: subData.timestamp
                            };
                        }
                    });
                    setSavedSubmissions(submissionsMap);
                    console.log('Loaded saved submissions:', Object.keys(submissionsMap).length);
                } catch (err) {
                    console.error('Error loading saved submissions:', err);
                }
            }

            // Set initial code from template (unless in preview mode with code already loaded)
            const isPreviewMode = params.get('previewMode') === 'true';
            const snippetData = sessionStorage.getItem('previewSnippet');

            if (isPreviewMode && snippetData) {
                const snippet = JSON.parse(snippetData);

                let targetIndex = -1;

                const rawSnippetId = snippet.id || '';
                const cleanSnippetId = (levelId && rawSnippetId.startsWith(levelId + '_'))
                    ? rawSnippetId.substring(levelId.length + 1)
                    : rawSnippetId;

                if (cleanSnippetId) {
                    targetIndex = allQuestions.findIndex(q => {
                        const qIdClean = (q.id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
                        const targetClean = cleanSnippetId.replace(/[^a-zA-Z0-9_-]/g, '_');
                        return qIdClean === targetClean || q.id === cleanSnippetId;
                    });
                }

                if (targetIndex === -1 && snippet.challengeId) {
                    const stepId = snippet.ackKey?.includes('--') ? snippet.ackKey.split('--')[1] : (snippet.stepId || null);
                    const targetChallengeId = stepId ? `${snippet.challengeId}_step_${stepId}` : snippet.challengeId;
                    targetIndex = allQuestions.findIndex(q => 
                        q.id === targetChallengeId || 
                        q.challengeId === snippet.challengeId ||
                        q.id === snippet.challengeId ||
                        (q.id && q.id.includes('_step_') && q.id.split('_step_')[0] === snippet.challengeId)
                    );
                }

                if (targetIndex === -1 && snippet.unitName && snippet.title) {
                    targetIndex = allQuestions.findIndex(q => 
                        (q.unitName || '').toLowerCase() === snippet.unitName.toLowerCase() &&
                        (q.title || '').toLowerCase() === snippet.title.toLowerCase()
                    );
                }

                if (targetIndex === -1 && snippet.title) {
                    const searchTitle = snippet.title?.toLowerCase() || '';
                    const searchChallengeName = snippet.challengeName?.toLowerCase() || '';
                    targetIndex = allQuestions.findIndex(q => {
                        const qTitle = (q.title || '').toLowerCase();
                        if (qTitle === searchTitle) return true;
                        if (searchTitle && (qTitle.includes(searchTitle) || searchTitle.includes(qTitle))) return true;
                        if (searchChallengeName && qTitle.includes(searchChallengeName)) return true;
                        return false;
                    });
                }

                if (targetIndex === -1) targetIndex = 0;

                console.log('Preview mode: navigating to question', targetIndex, 'for snippet:', snippet.id, snippet.title);

                // Navigate to the correct question and set the code
                setCurrentQuestionIndex(targetIndex);
                if (snippet.code) {
                    setCode(snippet.code);
                    setIsLoadedFromSubmission(true);
                } else if (allQuestions.length > 0) {
                    setCode(allQuestions[targetIndex]?.codeTemplate || '');
                }
            } else if (allQuestions.length > 0) {
                // Open the start question with its saved submission, if it has one
                setCurrentQuestionIndex(startIndex);
                const startQuestion = allQuestions[startIndex];
                const savedQuestionId = startQuestion?.id?.replace(/[^a-zA-Z0-9_-]/g, '_');
                if (savedQuestionId && submissionsMap[savedQuestionId]?.code) {
                    setCode(submissionsMap[savedQuestionId].code);
                    setIsLoadedFromSubmission(true);
                } else {
                    setCode(startQuestion?.codeTemplate || '');
                    setIsLoadedFromSubmission(false);
                }
            }

            setLoadingStage({ pct: 100, label: 'Ready!' });
            setLoading(false);
        } catch (error) {
            console.error('Error loading assessment:', error);
            setLoadingStage({ pct: 100, label: 'Error — please refresh.' });
            setLoading(false);
        }
    };
    // ── Input submission handler ──
    const handleInputSubmit = useCallback(() => {
        if (!inputRequest) return;
        collectedInputsRef.current.push(inputValue);
        setInputRequest(null);
        setInputValue('');
        // Re-run code with all collected inputs so far
        if (workerRef.current) {
            turtleModeRef.current = 'replay';
            armWatchdog();
            workerRef.current.postMessage({
                type: 'run',
                code: currentCodeRef.current,
                inputs: [...collectedInputsRef.current],
                seed: runSeedRef.current
            });
        }
    }, [inputRequest, inputValue, armWatchdog]);

    // ── Stop execution ──
    const stopExecution = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.terminate();
        }
        // Create a fresh worker
        createWorker();
        setIsRunning(false);
        setInputRequest(null);
        disarmWatchdog();
        setOutput(prev => prev + '\n[Program stopped by user]');
        if (runResolveRef.current) {
            runResolveRef.current(null);
            runResolveRef.current = null;
        }
    }, [createWorker, disarmWatchdog]);

    const runCode = async () => {
        setIsRunning(true);
        setOutput('');
        setFeedback(null);
        turtleModeRef.current = 'run';
        collectedInputsRef.current = []; // Reset collected inputs
        currentCodeRef.current = code; // Store current code for re-execution
        runSeedRef.current = Math.floor(Math.random() * 2 ** 31);

        return new Promise((resolve) => {
            runResolveRef.current = resolve;
            armWatchdog();
            workerRef.current.postMessage({
                type: 'run',
                code: code,
                inputs: [],
                seed: runSeedRef.current
            });
        });
    };

    // Handle submission comment and advance to next question
    const handleCommentSubmit = async () => {
        if (!pendingAdvance) return;

        try {
            // Update the acknowledgement with the comment
            if (pendingAdvance.challengeId && pendingAdvance.unitId) {
                const challengeRef = doc(
                    db,
                    'codingLevels',
                    levelId,
                    'units_new',
                    pendingAdvance.unitId,
                    'challenges',
                    pendingAdvance.challengeId
                );

                const challengeSnap = await getDoc(challengeRef);
                if (challengeSnap.exists()) {
                    const challengeData = challengeSnap.data();
                    const acknowledgements = challengeData.acknowledgements || {};
                    const ackKey = `${currentUser.username.toLowerCase()}--${pendingAdvance.stepId}`;

                    if (acknowledgements[ackKey]) {
                        acknowledgements[ackKey].submissionComment = submissionComment;
                        await updateDoc(challengeRef, { acknowledgements });
                        clearCache();
                    }
                }
            }
        } catch (error) {
            console.error('Error saving submission comment:', error);
        }

        // Close modal and advance
        setShowCommentModal(false);
        setSubmissionComment("");
        const nextIndex = pendingAdvance.questionIndex + 1;
        setPendingAdvance(null);
        if (nextIndex < questions.length) {
            goToQuestion(nextIndex);
        }
    };

    const handleSaveProgress = async () => {
        if (!currentUser || saving) return;
        
        const question = questions[currentQuestionIndex];
        if (!question) return;

        setSaving(true);
        try {
            const questionDescription = question.instructions ||
                question.description ||
                question.content ||
                `Complete the challenge: ${question.title}`;

            const submissionId = `${levelId}_${question.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');

            await setDoc(doc(db, 'users', currentUser.username.toLowerCase(), 'submissions', submissionId), {
                code: code,
                title: question.title,
                description: questionDescription,
                levelName: level?.name || 'Unknown',
                unitName: question.unitName,
                unitNumber: question.unitNumber || 0,
                order: question.order || 0,
                timestamp: serverTimestamp(),
                expectedOutput: question.expectedOutput,
                actualOutput: output || '',
                isDraft: true
            });

            // Update local savedSubmissions cache so navigating back shows the latest code
            const savedQuestionId = question.id?.replace(/[^a-zA-Z0-9_-]/g, '_');
            if (savedQuestionId) {
                setSavedSubmissions(prev => ({
                    ...prev,
                    [savedQuestionId]: { code: code, output: output || '', timestamp: new Date() }
                }));
            }

            alert('Progress saved successfully!');
        } catch (error) {
            console.error('Error saving progress:', error);
            alert('Failed to save progress. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const submitAnswer = async () => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        turtleModeRef.current = 'submit';
        turtleRunsRef.current = [];
        try {
            await gradeAndSubmit();
        } finally {
            turtleModeRef.current = 'run';
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    // A step passed but saving it failed (offline, Firestore quota): it stays
    // incomplete, so the next question stays locked until it is saved
    const showSaveFailed = (error) => {
        console.error('Error saving passed answer:', error);
        playSound('error');
        setFeedback({
            type: 'error',
            message: '⚠️ Your answer passed, but it could not be saved',
            details: 'Check your internet connection, then try again.'
        });
    };

    // There's no way past a question other than passing its checks: no
    // Force Submit and no Skip
    const gradeAndSubmit = async () => {
        const question = questions[currentQuestionIndex];

        // Check if question has code requirements (mustHave, minVariables, etc.)
        const hasCodeRequirements = question.requirements && (
            (question.requirements.mustHave && question.requirements.mustHave.length > 0) ||
            (question.requirements.mustNotHave && question.requirements.mustNotHave.length > 0) ||
            (question.requirements.minVariables && question.requirements.minVariables > 0) ||
            (question.requirements.minLines && question.requirements.minLines > 0)
        );

        // Check if this is an instruction-only question
        // A question is instruction-only ONLY when:
        //   - no expectedOutput  AND
        //   - no code requirements (mustHave / mustNotHave / minLines / minVariables)  AND
        //   - no test cases
        const isInstructionOnly = (!question.expectedOutput || question.expectedOutput.trim() === '')
            && !hasCodeRequirements
            && !(question.testCases && question.testCases.length > 0);

        if (isInstructionOnly) {
            // Mark as complete without code validation
            const newCompleted = [...completedQuestions];
            if (!newCompleted.includes(question.id)) {
                newCompleted.push(question.id);

                // Save to Firebase
                if (currentUser?.role === 'teacher' && currentUser.id) {
                    const percentage = Math.round((newCompleted.length / questions.length) * 100);
                    try {
                        await setDoc(
                            doc(db, 'teachers', currentUser.id, 'progress', levelId),
                            {
                                completedQuestions: newCompleted,
                                percentage,
                                lastUpdated: new Date()
                            },
                            { merge: true }
                        );
                    } catch (error) {
                        showSaveFailed(error);
                        return;
                    }
                }
                setCompletedQuestions(newCompleted);
            }

            playSound('success');
            setFeedback({
                type: 'success',
                message: '✅ Completed! You can now proceed to the next question.',
                details: 'Click the next question to continue.'
            });
            return;
        }
        
        // Check if this is a code-requirements-only question (no expected output but has requirements)
        const isCodeRequirementsOnly = (!question.expectedOutput || question.expectedOutput.trim() === '') && hasCodeRequirements;

        // Check if code has meaningful content (not just comments or template)
        const codeLines = code.split('\n').filter(line => {
            const trimmed = line.trim();
            return trimmed.length > 0 && !trimmed.startsWith('#');
        });

        if (codeLines.length === 0) {
            playSound('error');
            setFeedback({
                type: 'error',
                message: '❌ Please write some code first',
                details: 'You need to write Python code to solve this problem.'
            });
            return;
        }

        // Track attempts
        const currentAttempts = (attemptCounts[question.id] || 0) + 1;
        setAttemptCounts({ ...attemptCounts, [question.id]: currentAttempts });

        const normalizeOutput = (str) => {
            if (!str) return '';
            // Split by newline, remove trailing spaces from each line, rejoin, and strip ends
            return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
                      .split('\n')
                      .map(line => line.trimEnd())
                      .join('\n')
                      .trim();
        };

        // Check if question has test cases (for input-based questions)
        const testCases = question.testCases || [];

        let outputCorrect = false;
        let codeOutput = '';
        let testResults = [];
        let scriptValidationPassed = true;
        let scriptValidationError = null;

        if (testCases.length > 0) {
            // Run all test cases via worker
            const testResult = await new Promise((resolve) => {
                const handler = (e) => {
                    if (e.data.type === 'test_done') {
                        workerRef.current.removeEventListener('message', handler);
                        resolve(e.data);
                    }
                };
                workerRef.current.addEventListener('message', handler);
                workerRef.current.postMessage({
                    type: 'test',
                    code: code,
                    testCases: testCases,
                    validationScript: question.validationScript || ''
                });
            });

            let allPassed = true;
            let combinedConsoleOutput = '';

            for (let i = 0; i < testResult.results.length; i++) {
                const result = testResult.results[i];
                const isLast = i === testResult.results.length - 1;

                testResults.push({
                    input: result.input,
                    expectedOutput: result.expectedOutput,
                    actualOutput: result.actualOutput,
                    passed: result.passed
                });

                combinedConsoleOutput += `== Test Case ${i + 1} ==\n`;
                combinedConsoleOutput += `Input:  ${Array.isArray(result.input) ? result.input.join(' ') : result.input}\n`;
                if (result.error) {
                    combinedConsoleOutput += `Result: ❌ ERROR\n${result.error}\n`;
                } else {
                    combinedConsoleOutput += `Expected Output:\n${result.expectedOutput}\n`;
                    combinedConsoleOutput += `Your Output:\n${result.actualOutput}`;
                    // Output that doesn't end in a newline (print(..., end=''),
                    // or the first lines of a run-forever program) would run into "Result:"
                    if (!result.actualOutput.endsWith('\n')) combinedConsoleOutput += '\n';
                    combinedConsoleOutput += `Result: ${result.passed ? '✅ PASS' : '❌ FAIL'}\n`;
                }
                if (!isLast) combinedConsoleOutput += `\n`;

                if (!result.passed) allPassed = false;
                codeOutput = result.actualOutput;
            }

            outputCorrect = allPassed;
            setOutput(combinedConsoleOutput);
            const failedIndex = testResult.results.findIndex(result => !result.passed);
            showGradedTurtle(failedIndex >= 0 ? failedIndex : testResult.results.length - 1);

            // Use validation result from worker
            scriptValidationPassed = testResult.validationResult.passed;
            scriptValidationError = testResult.validationResult.error;
        } else {
            // No test cases - run code via worker for simple output matching
            const submitResult = await new Promise((resolve) => {
                const handler = (e) => {
                    if (e.data.type === 'submit_done') {
                        workerRef.current.removeEventListener('message', handler);
                        resolve(e.data);
                    }
                };
                workerRef.current.addEventListener('message', handler);
                workerRef.current.postMessage({
                    type: 'submit_run',
                    code: code,
                    validationScript: question.validationScript || ''
                });
            });
            showGradedTurtle(0);

            if (submitResult.error) {
                setOutput(`Error: ${submitResult.error}`);
                playSound('error');
                setFeedback({ type: 'error', message: 'Code has errors.', details: submitResult.error });
                return;
            }

            codeOutput = submitResult.output;
            setOutput(codeOutput);
            // A step with only code requirements has no output to match. It is
            // then saved for review and moves on like every other passed step
            outputCorrect = isCodeRequirementsOnly ||
                normalizeOutput(codeOutput) === normalizeOutput(question.expectedOutput);

            // Use validation result from worker
            scriptValidationPassed = submitResult.validationResult.passed;
            scriptValidationError = submitResult.validationResult.error;
        }

        // Step 2: Validate code requirements
        const codeValidation = validateCodeRequirements(code, question.requirements);

        // Step 3: Check if output is empty when it shouldn't be
        const hasEmptyOutput = codeOutput.trim() === '' && question.expectedOutput.trim() !== '' && testCases.length === 0;

        // Step 4: Determine if passed
        const passed = outputCorrect && codeValidation.valid && !hasEmptyOutput && scriptValidationPassed;

        if (passed) {
            const newCompleted = completedQuestions.includes(question.id)
                ? completedQuestions
                : [...completedQuestions, question.id];

            // An instructor's pass only counts once it is saved: if saving fails
            // (offline, Firestore quota) say so, and keep the next question locked
            if (currentUser?.role === 'teacher' && currentUser.id) {
                try {
                    // Save local progress (for UI purposes only, not official training progress)
                    if (newCompleted !== completedQuestions) {
                        const percentage = Math.round((newCompleted.length / questions.length) * 100);
                        await setDoc(
                            doc(db, 'teachers', currentUser.id, 'progress', levelId),
                            {
                                completedQuestions: newCompleted,
                                percentage,
                                lastUpdated: new Date(),
                                note: 'Local progress - official progress based on admin approvals'
                            },
                            { merge: true }
                        );
                    }

                    // Save submission for admin review
                    // Get the full question description
                    const questionDescription = question.instructions ||
                        question.description ||
                        question.content ||
                        `Complete the challenge: ${question.title}`;

                    // Create a unique ID for this submission based on level and question
                    // This ensures we update existing submissions instead of creating duplicates
                    const submissionId = `${levelId}_${question.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');

                    await setDoc(doc(db, 'users', currentUser.username.toLowerCase(), 'submissions', submissionId), {
                        code: code,
                        title: question.title,
                        description: questionDescription,
                        levelName: level?.name || 'Unknown',
                        unitName: question.unitName,
                        unitNumber: question.unitNumber || 0,
                        order: question.order || 0,
                        timestamp: serverTimestamp(),
                        expectedOutput: question.expectedOutput,
                        actualOutput: codeOutput
                    });

                    // Create pending review for admin
                    // Update the challenge document with acknowledgement
                    if (question.challengeId && question.unitId) {
                        console.log('Creating pending review for:', {
                            levelId,
                            unitId: question.unitId,
                            challengeId: question.challengeId,
                            username: currentUser.username,
                            stepId: question.stepId
                        });

                        const challengeRef = doc(
                            db,
                            'codingLevels',
                            levelId,
                            'units_new',
                            question.unitId,
                            'challenges',
                            question.challengeId
                        );

                        const challengeSnap = await getDoc(challengeRef);
                        if (challengeSnap.exists()) {
                            const challengeData = challengeSnap.data();
                            const acknowledgements = challengeData.acknowledgements || {};

                            // Clean up large fields (code, blocklyXml, output, questionInstructions) for all users in the acknowledgements map
                            Object.keys(acknowledgements).forEach(key => {
                                if (acknowledgements[key]) {
                                    delete acknowledgements[key].code;
                                    delete acknowledgements[key].blocklyXml;
                                    delete acknowledgements[key].output;
                                    delete acknowledgements[key].questionInstructions;
                                }
                            });

                            // Use composite key to support per-step status
                            // Format: username--stepId
                            const ackKey = `${currentUser.username.toLowerCase()}--${question.stepId}`;

                            // Always create/update pending review on new submission
                            acknowledgements[ackKey] = {
                                status: 'pending',
                                submittedAt: serverTimestamp(),
                                questionTitle: question.title,
                                expectedOutput: question.expectedOutput,
                                username: currentUser.username.toLowerCase(), // Store username for AdminPanel
                                stepId: question.stepId,
                                submissionComment: ''
                            };

                            await updateDoc(challengeRef, {
                                acknowledgements: acknowledgements
                            });
                            clearCache();
                            console.log('Pending review created successfully!');

                            // Update local savedSubmissions cache so navigating back shows the latest code
                            const savedQuestionId = question.id?.replace(/[^a-zA-Z0-9_-]/g, '_');
                            if (savedQuestionId) {
                                setSavedSubmissions(prev => ({
                                    ...prev,
                                    [savedQuestionId]: { code: code, output: codeOutput, timestamp: new Date() }
                                }));
                            }
                        } else {
                            console.error('Challenge document not found!');
                        }
                    } else {
                        console.error('Missing challengeId or unitId:', question);
                    }
                } catch (error) {
                    showSaveFailed(error);
                    return;
                }
            }

            // Reset attempts for this question
            setAttemptCounts({ ...attemptCounts, [question.id]: 0 });

            // Mark as complete locally (for UI to show progress and unlock next questions)
            setCompletedQuestions(newCompleted);

            playSound('success');
            setFeedback({
                type: 'success',
                message: '✅ Correct! Well done!',
                details: isCodeRequirementsOnly
                    ? 'Your code meets all requirements. Moving to next question...'
                    : 'Your code produces the correct output and follows best practices. Moving to next question...'
            });

            // Auto-advance after 2 seconds for all users
            setTimeout(() => {
                const nextIndex = currentQuestionIndex + 1;
                if (nextIndex < questions.length) {
                    goToQuestion(nextIndex);
                } else {
                    playSound('success');
                    setShowCongratulations(true);
                }
            }, 2000);
        } else {
            // Show specific feedback
            let message = '';
            let details = [];

            if (!scriptValidationPassed) {
                message = `❌ Attempt ${currentAttempts}: Custom Validation Failed`;
                details.push(scriptValidationError);
            } else if (!outputCorrect) {
                message = `❌ Attempt ${currentAttempts}: Output doesn't match expected result`;

                // Show test case results if available
                if (testResults.length > 0) {
                    details.push('Test Results:');
                    testResults.forEach((result, idx) => {
                        const status = result.passed ? '✅' : '❌';
                        const inputStr = Array.isArray(result.input) ? result.input.join(', ') : result.input;
                        details.push(`${status} Test ${idx + 1}: input(${inputStr})`);
                        if (!result.passed) {
                            details.push(`   Expected: ${result.expectedOutput}`);
                            details.push(`   Got: ${result.actualOutput.trim()}`);
                        }
                    });
                } else {
                    details.push(`Expected: ${question.expectedOutput}`);
                    details.push(`Got: ${codeOutput}`);
                }
            }

            if (!codeValidation.valid) {
                message = message || `⚠️ Attempt ${currentAttempts}: Code doesn't meet requirements`;
                details = [...details, ...codeValidation.issues];
            }

            playSound('error');
            setFeedback({
                type: 'error',
                message,
                details: details.join('\n')
            });
        }
    };

    const goToQuestion = (index) => {
        setLoadingQuestion(true);

        // Simulate loading delay for smooth transition
        setTimeout(() => {
            setCurrentQuestionIndex(index);

            // Check if this question has a saved submission — load that code instead of the template
            const targetQuestion = questions[index];
            const savedQuestionId = targetQuestion?.id?.replace(/[^a-zA-Z0-9_-]/g, '_');
            if (savedQuestionId && savedSubmissions[savedQuestionId]?.code) {
                setCode(savedSubmissions[savedQuestionId].code);
                setIsLoadedFromSubmission(true);
            } else {
                setCode(targetQuestion?.codeTemplate || '');
                setIsLoadedFromSubmission(false);
            }

            setOutput('');
            setFeedback(null);
            turtleStream.reset();
            setTurtleView('none');
            setLoadingQuestion(false);
        }, 300);
    };

    const isQuestionUnlocked = (index) => {
        // Admin and Trainer can access all
        if (currentUser?.role === 'admin' || currentUser?.role === 'trainer') return true;
        // First question always unlocked
        if (index === 0) return true;
        // Others unlock after previous is completed
        return completedQuestions.includes(questions[index - 1]?.id);
    };

    const handleReviewAction = async (status) => {
        if (!previewSnippet) return;
        
        const { levelId, unitId, challengeId, username, ackKey } = previewSnippet;
        
        if (!levelId || !unitId || !challengeId) {
            alert("Missing required review data (levelId, unitId, or challengeId)");
            return;
        }
        
        let comment = "";
        if (status === "needs_revision") {
            comment = window.prompt("Please enter comment/feedback for revision request:");
            if (comment === null) return; // Cancelled
            if (!comment.trim()) {
                alert("A comment/feedback is required for revisions.");
                return;
            }
        } else {
            const confirmApprove = window.confirm(`Approve ${username || 'User'}'s submission?`);
            if (!confirmApprove) return;
        }
        
        try {
            const chRef = doc(
                db,
                "codingLevels",
                levelId,
                "units_new",
                unitId,
                "challenges",
                challengeId
            );
            
            const snap = await getDoc(chRef);
            if (snap.exists()) {
                const data = snap.data();
                const acks = data.acknowledgements || {};
                const comments = data.submissionComments || {};
                
                const keyToUpdate = ackKey || username?.toLowerCase();
                if (!keyToUpdate) {
                    alert("Could not determine key to update");
                    return;
                }
                
                acks[keyToUpdate] = {
                    ...acks[keyToUpdate],
                    status,
                    reviewedAt: serverTimestamp(),
                };
                
                if (comment) {
                    comments[keyToUpdate] = comment;
                }
                
                await updateDoc(chRef, {
                    acknowledgements: acks,
                    submissionComments: comments,
                });
                
                clearCache();
                alert(status === "approved" ? "Submission approved successfully!" : "Revision requested successfully!");
                
                sessionStorage.removeItem('previewMode');
                sessionStorage.removeItem('previewSnippet');
                sessionStorage.removeItem('reviewPreview');
                window.close();
            } else {
                alert("Challenge document not found in database.");
            }
        } catch (error) {
            console.error("Error updating review status:", error);
            alert("Error updating review status: " + error.message);
        }
    };

    if (loading) {
        const { pct, label } = loadingStage;
        return (
            <div style={{
                minHeight: '100vh',
                background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2rem',
                padding: '2rem',
            }}>
                {/* Logo / Icon */}
                <div style={{
                    width: '72px', height: '72px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg,#7c3aed,#a78bfa)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 40px rgba(124,58,237,0.45)',
                    fontSize: '2rem',
                    animation: 'loadPulseLogo 2s ease-in-out infinite',
                }}>
                    🐍
                </div>

                {/* Title */}
                <div style={{ textAlign: 'center' }}>
                    <h2 style={{ color: '#fff', fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>Python Learning Portal</h2>
                    <p style={{ color: '#a78bfa', fontSize: '0.85rem', marginTop: '0.3rem' }}>Advanced Level</p>
                </div>

                {/* Progress Container */}
                <div style={{ width: '100%', maxWidth: '420px' }}>
                    {/* Percentage + Label row */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '0.55rem',
                    }}>
                        <span style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            color: '#c4b5fd', fontSize: '0.82rem', fontWeight: 600,
                        }}>
                            <span style={{
                                display: 'inline-block',
                                width: '7px', height: '7px',
                                borderRadius: '50%',
                                background: '#a78bfa',
                                animation: 'loadDotPulse 0.9s ease-in-out infinite alternate',
                            }} />
                            {label}
                        </span>
                        <span style={{
                            color: '#a78bfa',
                            fontSize: '0.9rem',
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                        }}>
                            {pct}%
                        </span>
                    </div>

                    {/* Progress bar track */}
                    <div style={{
                        height: '8px',
                        borderRadius: '9999px',
                        background: 'rgba(255,255,255,0.08)',
                        overflow: 'hidden',
                    }}>
                        <div style={{
                            height: '100%',
                            width: `${pct}%`,
                            borderRadius: '9999px',
                            background: 'linear-gradient(90deg,#7c3aed,#a78bfa,#c4b5fd)',
                            backgroundSize: '200% 100%',
                            transition: 'width 0.5s cubic-bezier(.4,0,.2,1)',
                            animation: 'loadShimmer 1.6s linear infinite',
                        }} />
                    </div>

                    {/* Stage step pills */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: '0.75rem',
                        gap: '0.25rem',
                    }}>
                        {[
                            { threshold: 10,  icon: '🔑', name: 'Level' },
                            { threshold: 25,  icon: '📚', name: 'Curriculum' },
                            { threshold: 55,  icon: '❓', name: 'Questions' },
                            { threshold: 70,  icon: '📊', name: 'Progress' },
                            { threshold: 88,  icon: '💾', name: 'Submissions' },
                            { threshold: 100, icon: '✅', name: 'Ready' },
                        ].map(stage => (
                            <div key={stage.name} style={{
                                flex: 1,
                                textAlign: 'center',
                                opacity: pct >= stage.threshold ? 1 : 0.3,
                                transition: 'opacity 0.4s ease',
                            }}>
                                <div style={{ fontSize: '1rem' }}>{stage.icon}</div>
                                <div style={{ fontSize: '0.6rem', color: '#c4b5fd', marginTop: '0.15rem', fontWeight: 600 }}>
                                    {stage.name}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <style>{`
                    @keyframes loadShimmer {
                        0%   { background-position: 200% center; }
                        100% { background-position: -200% center; }
                    }
                    @keyframes loadDotPulse {
                        from { opacity: 1; transform: scale(1); }
                        to   { opacity: 0.4; transform: scale(0.65); }
                    }
                    @keyframes loadPulseLogo {
                        0%, 100% { transform: scale(1);    box-shadow: 0 0 40px rgba(124,58,237,0.45); }
                        50%      { transform: scale(1.07); box-shadow: 0 0 60px rgba(124,58,237,0.7); }
                    }
                `}</style>
            </div>
        );
    }

    const currentQuestion = questions[currentQuestionIndex];
    const isCompleted = completedQuestions.includes(currentQuestion?.id);
    const needsRevision = revisionsNeeded.includes(currentQuestion?.id);
    const progress = Math.round((completedQuestions.length / questions.length) * 100);

    // File Management Helpers
    const openNewFileModal = () => { setEditingFile(null); setFileModalOpen(true); };
    const openEditFileModal = (file) => { setEditingFile(file); setFileModalOpen(true); };

    return (
        <div className="h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 flex flex-col">
            {/* Preview Mode Banner */}
            {previewSnippet && (
                <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between shrink-0 flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                        <span className="font-bold">📋 Review Preview</span>
                        <span className="text-amber-200">|</span>
                        <span>
                            <strong className="capitalize">{previewSnippet.username || 'Unknown'}</strong>'s submission: <strong>{previewSnippet.title}</strong>
                        </span>
                        {previewSnippet.levelName && (
                            <>
                                <span className="text-amber-200">|</span>
                                <span className="text-amber-100">{previewSnippet.levelName}</span>
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {(currentUser?.role === 'admin' || currentUser?.role === 'trainer') && (
                            <>
                                <button
                                    onClick={() => handleReviewAction('approved')}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded text-sm transition-colors flex items-center gap-1.5 shadow-sm"
                                >
                                    <CheckCircle size={14} />
                                    Approve Submission
                                </button>
                                <button
                                    onClick={() => handleReviewAction('needs_revision')}
                                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded text-sm transition-colors flex items-center gap-1.5 shadow-sm"
                                >
                                    <AlertCircle size={14} />
                                    Request Revision
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => {
                                sessionStorage.removeItem('previewMode');
                                sessionStorage.removeItem('previewSnippet');
                                sessionStorage.removeItem('reviewPreview');
                                window.close();
                            }}
                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 rounded text-sm font-medium transition-colors"
                        >
                            Close Preview
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 flex overflow-hidden">
                {/* Simplified Sidebar - Current Question Only */}
                <div className="w-64 bg-slate-900 text-white p-4 flex flex-col">
                    {/* Home Button */}
                    <button
                        onClick={() => {
                            // Try to close the window first (works if opened via JS)
                            window.close();
                            // Fallback: remove portalLevelId and reload to go back to main app
                            setTimeout(() => {
                                const url = new URL(window.location.href);
                                url.searchParams.delete('portalLevelId');
                                window.location.href = url.toString();
                            }, 100);
                        }}
                        className="mb-4 flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                            <polyline points="9 22 9 12 15 12 15 22"></polyline>
                        </svg>
                        Home
                    </button>

                    <div className="mb-6">
                        <h2 className="text-xl font-bold mb-2">{level?.name}</h2>
                        {currentUser?.role === 'teacher' && (
                            <>
                                <div className="text-sm text-slate-400">
                                    Progress: {completedQuestions.length}/{questions.length}
                                </div>
                                <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
                                    <div
                                        className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${progress}%` }}></div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Tabs: Question / Files */}
                    <div className="flex gap-1 mb-4 bg-slate-800 p-1 rounded-lg">
                        <button
                            onClick={() => setSidebarTab('questions')}
                            className={`flex-1 py-2 px-3 rounded text-xs font-medium transition-colors ${sidebarTab === 'questions'
                                    ? 'bg-violet-600 text-white'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            Question
                        </button>
                        <button
                            onClick={() => setSidebarTab('files')}
                            className={`flex-1 py-2 px-3 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${sidebarTab === 'files'
                                    ? 'bg-violet-600 text-white'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            <FileText size={12} />
                            Files {userFiles.length > 0 && `(${userFiles.length})`}
                        </button>
                    </div>

                    {/* Content based on tab */}
                    <div className="flex-grow overflow-y-auto">
                        {sidebarTab === 'questions' ? (
                            <div className="bg-violet-600 text-white p-4 rounded-lg flex flex-col shadow-inner">
                                <div className="flex items-start justify-between mb-3 gap-2">
                                    <div className="flex-1">
                                        {currentQuestion?.unitName && (
                                            <span className="inline-block px-2.5 py-1 bg-violet-400/30 border border-violet-400/50 rounded-md text-[10px] font-bold text-violet-50 uppercase tracking-widest shadow-sm">
                                                {currentQuestion.unitName}
                                            </span>
                                        )}
                                        {!currentQuestion?.unitName && (
                                            <span className="text-xs text-violet-200">Current Question</span>
                                        )}
                                    </div>
                                    {(currentUser?.role === 'admin' || currentUser?.role === 'trainer') && questions.length > 1 && (
                                        <button 
                                            onClick={() => goToQuestion(questions.length - 1)}
                                            className="px-2 py-1 bg-violet-800 hover:bg-violet-900 rounded text-[10px] uppercase font-bold tracking-wider transition-colors border border-violet-500/50 shadow-sm whitespace-nowrap"
                                            title="Jump to last question"
                                        >
                                            Skip to Last
                                        </button>
                                    )}
                                </div>
                                
                                <h3 className="text-lg font-bold text-white mb-3 leading-snug">
                                    {currentQuestion?.title || 'Loading...'}
                                </h3>
                                
                                <div className="relative">
                                    <select
                                        value={currentQuestionIndex}
                                        onChange={(e) => {
                                            const idx = Number(e.target.value);
                                            if (isQuestionUnlocked(idx) || currentUser?.role === 'admin' || currentUser?.role === 'trainer') {
                                                goToQuestion(idx);
                                            }
                                        }}
                                        className="bg-violet-700/60 hover:bg-violet-700/80 text-violet-100 font-medium text-sm p-2.5 rounded-lg border border-violet-500/50 focus:border-violet-300 focus:ring-2 focus:ring-violet-300/50 cursor-pointer outline-none w-full transition-all appearance-none pr-8"
                                    >
                                        {questions.map((q, idx) => {
                                            const unlocked = isQuestionUnlocked(idx) || currentUser?.role === 'admin' || currentUser?.role === 'trainer';
                                            return (
                                                <option 
                                                    key={idx} 
                                                    value={idx} 
                                                    disabled={!unlocked}
                                                    className={unlocked ? 'bg-slate-800 text-white p-2' : 'bg-slate-800 text-slate-500 p-2'}
                                                >
                                                    Q{idx + 1} of {questions.length} - {q.unitName ? `${q.unitName}: ` : ''}{q.title || 'Untitled'} {!unlocked ? '(Locked)' : ''}
                                                </option>
                                            );
                                        })}
                                    </select>
                                    <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-violet-300">
                                        <ChevronDown size={14} />
                                    </div>
                                </div>
                                
                                {needsRevision && (
                                    <div className="mt-3 flex items-center gap-2 text-amber-300 text-xs">
                                        <AlertCircle size={14} />
                                        <span>Needs Revision</span>
                                    </div>
                                )}
                                {isCompleted && !needsRevision && (
                                    <div className="mt-3 flex items-center gap-2 text-emerald-300 text-xs">
                                        <CheckCircle size={14} />
                                        <span>Completed</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {/* New File Button */}
                                <button
                                    onClick={openNewFileModal}
                                    className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Plus size={16} /> New File
                                </button>

                                {/* File I/O Help */}
                                <div className="p-3 bg-blue-900/30 rounded-lg border border-blue-700/50">
                                    <p className="text-xs text-blue-300 mb-2 font-medium">📁 File I/O:</p>
                                    <pre className="text-[10px] text-blue-200 font-mono whitespace-pre-wrap leading-relaxed">{`# Write
with open('f.txt','w') as f:
    f.write('Hi')

# Read
with open('f.txt') as f:
    print(f.read())`}</pre>
                                </div>

                                {/* Files List */}
                                {userFiles.length === 0 ? (
                                    <div className="text-center text-slate-500 text-sm italic py-4">
                                        No files yet
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {userFiles.map(file => (
                                            <div
                                                key={file.name}
                                                className="group flex items-center justify-between p-2 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors"
                                            >
                                                <div
                                                    className="flex items-center gap-2 overflow-hidden flex-1 cursor-pointer"
                                                    onClick={() => openEditFileModal(file)}
                                                >
                                                    <FileText size={14} className="text-blue-400 flex-shrink-0" />
                                                    <div className="overflow-hidden">
                                                        <span className="text-xs text-slate-300 truncate block">{file.name}</span>
                                                        <span className="text-[10px] text-slate-500">{file.content?.length || 0} chars</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-0.5">
                                                    <button
                                                        onClick={() => openEditFileModal(file)}
                                                        className="p-1 text-slate-500 hover:text-blue-400 hover:bg-slate-600 rounded transition-colors"
                                                        title="Edit"
                                                    >
                                                        <Edit2 size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            if (window.confirm(`Delete "${file.name}"?`)) {
                                                                deleteFile(file.name);
                                                            }
                                                        }}
                                                        className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-600 rounded transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Navigation Buttons */}
                    <div className="mt-4 flex gap-2">
                        <button
                            onClick={() => {
                                if (currentQuestionIndex > 0) {
                                    goToQuestion(currentQuestionIndex - 1);
                                }
                            }}
                            disabled={currentQuestionIndex === 0}
                            className="flex-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-sm flex items-center justify-center gap-2">
                            <ChevronLeft size={16} />
                            Previous
                        </button>
                        <button
                            onClick={() => {
                                const nextIndex = currentQuestionIndex + 1;
                                if (nextIndex < questions.length && (isQuestionUnlocked(nextIndex) || currentUser?.role === 'admin' || currentUser?.role === 'trainer')) {
                                    goToQuestion(nextIndex);
                                }
                            }}
                            disabled={
                                currentQuestionIndex >= questions.length - 1 ||
                                (!isQuestionUnlocked(currentQuestionIndex + 1) && currentUser?.role !== 'admin' && currentUser?.role !== 'trainer')
                            }
                            className="flex-1 px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-sm flex items-center justify-center gap-2">
                            Next
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    {progress === 100 && (
                        <div className="mt-4 p-4 bg-emerald-900/30 rounded-lg border border-emerald-700">
                            <div className="flex items-center gap-2 text-emerald-400 mb-2">
                                <Award size={20} />
                                <span className="font-bold">All Done!</span>
                            </div>
                            <p className="text-xs text-emerald-300">
                                You've completed all questions!
                            </p>
                        </div>
                    )}
                </div>

                {/* Remove old QuestionsSidebar component call */}
                {/* <QuestionsSidebar
                levelName={level?.name}
                questions={questions}
                currentQuestionIndex={currentQuestionIndex}
                completedQuestions={completedQuestions}
                revisionsNeeded={revisionsNeeded}
                sidebarTab={sidebarTab}
                setSidebarTab={setSidebarTab}
                userFiles={userFiles}
                currentUser={currentUser}
                levelId={levelId}
                setCompletedQuestions={setCompletedQuestions}
                setCurrentQuestionIndex={setCurrentQuestionIndex}
                setCode={setCode}
                setOutput={setOutput}
                setFeedback={setFeedback}
                setAttemptCounts={setAttemptCounts}
                openNewFileModal={openNewFileModal}
                openEditFileModal={openEditFileModal}
                goToQuestion={goToQuestion}
                isQuestionUnlocked={isQuestionUnlocked}
            /> */}

                {/* Main Content - Code Editor & Task */}
                <div className="flex-grow flex relative">
                    {/* Loading Overlay */}
                    {loadingQuestion && (
                        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
                            <div className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-xl">
                                <div className="flex items-center gap-3">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
                                    <span className="text-slate-700 dark:text-slate-200 font-medium">Loading question...</span>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* Code Editor */}
                    <div ref={editorColumnRef} className="flex-1 min-w-0 flex flex-col bg-slate-900">
                        <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <span className="text-white text-sm font-medium">main.py</span>
                                {isLoadedFromSubmission && (
                                    <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold rounded uppercase tracking-wider animate-pulse">
                                        Previously Submitted
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-2">
                                {(() => {
                    // Determine if this question is a true instruction-only step
                    const qHasCodeRequirements = currentQuestion?.requirements && (
                        (currentQuestion.requirements.mustHave?.length > 0) ||
                        (currentQuestion.requirements.mustNotHave?.length > 0) ||
                        (currentQuestion.requirements.minVariables > 0) ||
                        (currentQuestion.requirements.minLines > 0)
                    );
                    const qIsInstructionOnly =
                        (!currentQuestion?.expectedOutput || currentQuestion.expectedOutput.trim() === '')
                        && !qHasCodeRequirements
                        && !(currentQuestion?.testCases?.length > 0);

                    if (qIsInstructionOnly) {
                        // Pure instruction step — only "Mark as Complete"
                        return (
                            <Button
                                onClick={submitAnswer}
                                disabled={isCompleted || submitting}
                                className="h-8 text-xs">
                                {isCompleted ? 'Completed' : 'Mark as Complete'}
                            </Button>
                        );
                    }
                    // Coding question — show Run + Submit
                    return (
                        <>
                            <Button
                                onClick={runCode}
                                disabled={isRunning || submitting}
                                variant="secondary"
                                className="h-8 text-xs">
                                <Play size={14} /> Run
                            </Button>
                            {isRunning && (
                                <Button
                                    onClick={stopExecution}
                                    className="h-8 text-xs bg-red-600 text-white hover:bg-red-700 border-none">
                                    <Square size={14} /> Stop
                                </Button>
                            )}
                            <Button
                                onClick={handleSaveProgress}
                                disabled={isRunning || saving}
                                variant="secondary"
                                className="h-8 text-xs">
                                <Save size={14} /> {saving ? 'Saving...' : 'Save Progress'}
                            </Button>
                            <Button
                                onClick={submitAnswer}
                                disabled={isRunning || submitting}
                                className="h-8 text-xs">
                                {submitting ? 'Checking…' : needsRevision ? 'Resubmit Answer' : isCompleted ? 'Revise & Resubmit' : 'Submit Answer'}
                            </Button>
                        </>
                    );
                })()}
                            </div>
                        </div>

                        <div className="flex-grow min-h-0 relative">
                            <ErrorBoundary>
                                <Editor
                                    height="100%"
                                    defaultLanguage="python"
                                    theme="vs-dark"
                                    value={code}
                                    onChange={(value) => { setCode(value || ""); setFeedback(null); setIsLoadedFromSubmission(false); }}
                                    options={{
                                        minimap: { enabled: false },
                                        fontSize: 14,
                                        scrollBeyondLastLine: false,
                                        automaticLayout: true,
                                        tabSize: 4,
                                        padding: { top: 16, bottom: 16 }
                                    }}
                                />
                            </ErrorBoundary>
                            {/* Turtle window, floating in the middle of the editor */}
                            {turtleView === 'open' && (
                                <TurtlePanel
                                    stream={turtleStream}
                                    running={isRunning}
                                    waitingForInput={!!inputRequest}
                                    catchUp={turtleCatchUp}
                                    onClose={() => setTurtleView('closed')}
                                />
                            )}
                        </div>

                        {/* Console resize handle: drag, arrow keys, double-click to reset */}
                        <div
                            role="separator"
                            aria-orientation="horizontal"
                            aria-label="Resize console"
                            aria-valuenow={consoleHeight}
                            tabIndex={0}
                            title="Drag to resize the console (double-click to reset)"
                            onPointerDown={startConsoleResize}
                            onKeyDown={onConsoleResizeKey}
                            onDoubleClick={() => setConsoleHeight(clampConsoleHeight(CONSOLE_DEFAULT_HEIGHT))}
                            className="group h-2 shrink-0 bg-slate-700 hover:bg-violet-500 focus-visible:bg-violet-500 outline-none cursor-row-resize touch-none flex items-center justify-center transition-colors"
                        >
                            <span className="w-10 h-0.5 rounded-full bg-slate-500 group-hover:bg-white group-focus-visible:bg-white" />
                        </div>

                        {/* Console Output */}
                        <div
                            className="shrink-0 bg-black flex flex-col"
                            style={{ height: consoleHeight, maxHeight: `calc(100% - ${CONSOLE_EDITOR_RESERVE}px)` }}
                        >
                            <div className="px-4 py-2 bg-slate-800 text-white text-xs font-semibold border-b border-slate-700 flex items-center justify-between">
                                <span>Console</span>
                                <div className="flex items-center gap-3">
                                    {turtleView === 'closed' && (
                                        <button
                                            type="button"
                                            onClick={() => { setTurtleCatchUp(true); setTurtleView('open'); }}
                                            className="flex items-center gap-1 text-[10px] font-medium text-slate-300 hover:text-white transition-colors"
                                        >
                                            <Move size={12} /> Show turtle
                                        </button>
                                    )}
                                    {isRunning && (
                                        <span className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-medium">
                                            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                                            Running…
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex-1 p-4 text-green-400 font-mono text-sm whitespace-pre-wrap overflow-auto">
                                {output || 'Run your code to see output...'}
                            </div>
                            {/* Inline Input Field */}
                            {inputRequest && (
                                <div className="px-3 py-2 bg-slate-900 border-t border-slate-700 flex items-center gap-2">
                                    <span className="text-yellow-400 text-xs font-mono">&#x25B6;</span>
                                    <input
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleInputSubmit(); }}
                                        placeholder="Type your input here…"
                                        autoFocus
                                        className="flex-1 bg-slate-800 text-green-300 font-mono text-sm px-3 py-1.5 rounded border border-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 outline-none placeholder:text-slate-500"
                                    />
                                    <button
                                        onClick={handleInputSubmit}
                                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded transition-colors"
                                    >
                                        Submit
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Task Panel */}
                    <TaskPanel
                        currentQuestion={currentQuestion}
                        currentQuestionIndex={currentQuestionIndex}
                        isCompleted={isCompleted}
                        needsRevision={needsRevision}
                        feedback={feedback}
                        attemptCount={attemptCounts[currentQuestion?.id] || 0}
                    />
                </div>
            </div>
            <FileModal
                isOpen={fileModalOpen}
                onClose={() => setFileModalOpen(false)}
                onSave={saveFile}
                initialName={editingFile ? editingFile.name : ""}
                initialContent={editingFile ? editingFile.content : ""}
            />
            {showCongratulations && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 max-w-md w-full text-center relative overflow-hidden">
                        {/* Confetti / Celebration effect */}
                        <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden select-none">
                            <div className="absolute top-[10%] left-[20%] text-4xl animate-bounce" style={{animationDelay: '0s'}}>🎉</div>
                            <div className="absolute top-[20%] left-[80%] text-4xl animate-bounce" style={{animationDelay: '0.2s'}}>⭐</div>
                            <div className="absolute top-[15%] left-[50%] text-4xl animate-bounce" style={{animationDelay: '0.4s'}}>🎈</div>
                            <div className="absolute top-[30%] left-[10%] text-3xl animate-pulse" style={{animationDelay: '0.1s'}}>✨</div>
                            <div className="absolute top-[40%] left-[85%] text-3xl animate-pulse" style={{animationDelay: '0.3s'}}>🎊</div>
                        </div>
                        
                        <div className="w-24 h-24 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner relative z-10">
                            <Award size={48} className="animate-pulse" />
                        </div>
                        
                        <h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-4 relative z-10">Congratulations!</h2>
                        <p className="text-slate-600 dark:text-slate-300 mb-8 text-lg relative z-10">
                            You have successfully finished all the challenges! Keep up the great work.
                        </p>
                        
                        <div className="flex gap-4 justify-center relative z-10">
                            <button 
                                onClick={() => {
                                    window.close();
                                    setTimeout(() => {
                                        const url = new URL(window.location.href);
                                        url.searchParams.delete('portalLevelId');
                                        window.location.href = url.toString();
                                    }, 100);
                                }}
                                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-lg shadow-emerald-600/30 transition-all transform hover:scale-105"
                            >
                                Return to Dashboard
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};
