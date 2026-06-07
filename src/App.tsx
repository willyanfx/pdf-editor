import { Toolbar } from "./components/Toolbar";
import { PdfViewer } from "./components/PdfViewer";

export default function App() {
  return (
    <main className="app">
      <Toolbar />
      <PdfViewer />
    </main>
  );
}
