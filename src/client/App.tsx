import { Booth } from "./pages/Booth";
import { Display } from "./pages/Display";
import { Guest } from "./pages/Guest";
import { Home } from "./pages/Home";
import { Overlay } from "./pages/Overlay";
import { QrPrint } from "./pages/QrPrint";

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "");
  const m = path.match(/^\/e\/([a-z0-9]+)(?:\/(booth|display|overlay|qr))?$/);
  if (!m) return <Home />;
  const [, slug, sub] = m;
  switch (sub) {
    case "booth":
      return <Booth slug={slug} />;
    case "display":
      return <Display slug={slug} />;
    case "overlay":
      return <Overlay slug={slug} />;
    case "qr":
      return <QrPrint slug={slug} />;
    default:
      return <Guest slug={slug} />;
  }
}
