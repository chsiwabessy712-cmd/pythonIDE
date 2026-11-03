// The demo level: two Python questions copied from the Training Manager's
// Firestore (Advance 1 → "Print Quotes" step 1 and "If-Else" step 1), stored
// at the same paths PythonAssessment reads them from:
//   codingLevels/{level}/units_new/{unit}/challenges/{challenge}/steps/{step}
// Only steps with difficulty "hard" become questions, as on the site.

export const LEVEL_ID = "demo-advance-level";
export const LEVEL_NAME = "Demo Advance Level";

const level = `codingLevels/${LEVEL_ID}`;

export const demoSeedDocs = {
  [level]: { name: LEVEL_NAME, category: "advance" },

  // Question 1: Print Quotes
  [`${level}/units_new/id_1774776907811_59ovpnxb2`]: { unitName: "Print", unitNumber: 1 },
  [`${level}/units_new/id_1774776907811_59ovpnxb2/challenges/id_1774776907811_0ealml9y7`]: {
    challengeName: "Print Quotes",
    orderIndex: 1,
    acknowledgements: {},
  },
  [`${level}/units_new/id_1774776907811_59ovpnxb2/challenges/id_1774776907811_0ealml9y7/steps/id_1774776994128_a4q07l6jx`]: {
    "id": "id_1774776994128_a4q07l6jx",
    "difficulty": "hard",
    "expectedOutput": "\"You're a smart coder\", the teacher praised the student.",
    "hint": "",
    "stepIndex": 0,
    "testCases": [],
    "content": "<p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">Display the following sentence on the screen using a print command (follow the punctuations):</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; font-weight: bold; font-style: italic; text-decoration-skip-ink: none;\">\"You're a smart coder\", the teacher praised the student.</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\"><u segoe=\"\" ui\",=\"\" roboto,=\"\" \"helvetica=\"\" neue\",=\"\" arial,=\"\" \"noto=\"\" sans\",=\"\" sans-serif,=\"\" \"apple=\"\" color=\"\" emoji\",=\"\" \"segoe=\"\" ui=\"\" symbol\",=\"\" emoji\";=\"\" font-size:=\"\" 16px;=\"\" white-space:=\"\" normal;\"=\"\"><span style=\"font-weight: bold;\">Test Output</span></u><br></span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><font face=\"Arial\"><span style=\"font-size: 15px; white-space-collapse: preserve;\"><span style=\"font-weight: bolder;\"><i>\"You're a smart coder\", the teacher praised the student.</i></span></span></font></p>"
  },

  // Question 2: If-Else
  [`${level}/units_new/id_1774778625197_ccjombv04`]: { unitName: "If Statement", unitNumber: 4 },
  [`${level}/units_new/id_1774778625197_ccjombv04/challenges/id_1774778625197_aynkm8r79`]: {
    challengeName: "If-Else",
    orderIndex: 3,
    acknowledgements: {},
  },
  [`${level}/units_new/id_1774778625197_ccjombv04/challenges/id_1774778625197_aynkm8r79/steps/id_1774778837589_lyyravoir`]: {
    "id": "id_1774778837589_lyyravoir",
    "stepIndex": 0,
    "requirements": {
      "mustHave": [
        "input",
        ".lower()",
        "if",
        "==",
        "else",
        "print"
      ],
      "minLines": 1,
      "mustNotHave": [],
      "maxLines": 10,
      "minVariables": 1
    },
    "difficulty": "hard",
    "content": "<p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">Create a program that asks the user to enter his or her feeling.\nUsing </span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; font-weight: bold; font-style: italic; text-decoration-skip-ink: none;\">if-else</span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\"> statement, perform the following:\n1. Display \"You are happy!\" if the input is \"happy\", regardless of whether the letters are small or capital letters.\n2. Display \"Tell me when you are happy\" if the input is not \"happy\"\n</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">Follow the test output display format.</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\"><u segoe=\"\" ui\",=\"\" roboto,=\"\" \"helvetica=\"\" neue\",=\"\" arial,=\"\" \"noto=\"\" sans\",=\"\" sans-serif,=\"\" \"apple=\"\" color=\"\" emoji\",=\"\" \"segoe=\"\" ui=\"\" symbol\",=\"\" emoji\";=\"\" font-size:=\"\" 16px;=\"\" white-space:=\"\" normal;\"=\"\"><span style=\"font-weight: bold;\">Test Input\n</span></u></span><span style=\"color: rgb(255, 0, 0); font-family: Arial; font-size: 15px; white-space-collapse: preserve;\">bored</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"color: rgb(255, 0, 0); font-family: Arial; font-size: 15px; white-space-collapse: preserve;\">mad</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"color: rgb(255, 0, 0); font-family: Arial; font-size: 15px; white-space-collapse: preserve;\">happy</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"color: rgb(255, 0, 0); font-family: Arial; font-size: 15px; white-space-collapse: preserve;\">hApPy</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><u segoe=\"\" ui\",=\"\" roboto,=\"\" \"helvetica=\"\" neue\",=\"\" arial,=\"\" \"noto=\"\" sans\",=\"\" sans-serif,=\"\" \"apple=\"\" color=\"\" emoji\",=\"\" \"segoe=\"\" ui=\"\" symbol\",=\"\" emoji\";=\"\" font-size:=\"\" 16px;=\"\" white-space:=\"\" normal;\"=\"\" style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve;\"><span style=\"font-weight: bold;\">Test Output (</span><span style=\"color: rgb(255, 0, 0); font-weight: bold;\">Red Text - User Input</span></u><span segoe=\"\" ui\",=\"\" roboto,=\"\" \"helvetica=\"\" neue\",=\"\" arial,=\"\" \"noto=\"\" sans\",=\"\" sans-serif,=\"\" \"apple=\"\" color=\"\" emoji\",=\"\" \"segoe=\"\" ui=\"\" symbol\",=\"\" emoji\";\"=\"\" style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve;\"><font face=\"Arial\"><span style=\"font-weight: bolder;\"><u>)</u></span></font></span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"color: rgb(0, 0, 255); font-family: Arial; font-size: 15px; white-space-collapse: preserve; font-style: italic; text-decoration-skip-ink: none;\">Test your program with the examples below:\n</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"color: rgb(0, 0, 255); font-family: Arial; font-size: 15px; white-space-collapse: preserve; font-style: italic; text-decoration-skip-ink: none;\">Example 1\n</span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">How do you feel? </span><span style=\"color: rgb(255, 0, 0); font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">bored\n</span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">Tell me when you are happy\n</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"color: rgb(0, 0, 255); font-family: Arial; font-size: 15px; white-space-collapse: preserve; font-style: italic; text-decoration-skip-ink: none;\">Example 2</span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">\nHow do you feel? </span><span style=\"color: rgb(255, 0, 0); font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">mad\n</span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">Tell me when you are happy\n</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"color: rgb(0, 0, 255); font-family: Arial; font-size: 15px; white-space-collapse: preserve; font-style: italic; text-decoration-skip-ink: none;\">Example 3</span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">\nHow do you feel? </span><span style=\"color: rgb(255, 0, 0); font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">happy\n</span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">You are happy!\n</span></p><p style=\"margin-bottom: 10px; color: rgb(0, 0, 0); font-family: -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, &quot;Noto Sans&quot;, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-size: 16px;\"><span style=\"color: rgb(0, 0, 255); font-family: Arial; font-size: 15px; white-space-collapse: preserve; font-style: italic; text-decoration-skip-ink: none;\">Example 4</span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">\nHow do you feel? </span><span style=\"color: rgb(255, 0, 0); font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">hApPy</span><span style=\"font-family: Arial; font-size: 15px; white-space-collapse: preserve; text-decoration-skip-ink: none;\">\nYou are happy!</span></p>",
    "hint": "To make the check case-insensitive, use feeling.lower() == \"happy\". The 'else' statement does not need a condition; it simply catches everything that didn't pass the 'if' check.",
    "testCases": [
      {
        "input": "bored",
        "expectedOutput": "Tell me when you are happy"
      },
      {
        "input": "mad",
        "expectedOutput": "Tell me when you are happy"
      },
      {
        "input": "happy",
        "expectedOutput": "You are happy!"
      },
      {
        "input": "hApPy",
        "expectedOutput": "You are happy!"
      }
    ],
    "expectedOutput": "Tell me when you are happy\nYou are happy!",
    "starterCode": "# 1. Ask for user feeling input\n# 2. Use .lower() to normalize the input string\n# 3. Create an 'if-else' block\n#    - If feeling is \"happy\", print \"You are happy!\"\n#    - Otherwise (else), print \"Tell me when you are happy\"\n",
    "allowManualSubmit": false
  },
};
