import React from "react";
import { PythonAssessment } from "./components/common/PythonAssessment";
import { seedDocs } from "./firebase/firestore";
import { demoSeedDocs, LEVEL_ID } from "./data/demoLevel";

seedDocs(demoSeedDocs);

const App = () => {
  const initialQuestionIndex = parseInt(new URLSearchParams(window.location.search).get("questionIndex")) || 0;
  return <PythonAssessment levelId={LEVEL_ID} initialQuestionIndex={initialQuestionIndex} />;
};

export default App;
