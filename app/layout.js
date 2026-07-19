import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "SynthAI — Multi-Model DSA Assistant",
  description:
    "Ask a coding question and get a synthesized best answer from OpenAI, Claude, and Gemini.",
};

function Navbar() {
  return (
    <>
      <style>{`
        .synthai-nav {
          position: sticky;
          top: 0;
          z-index: 50;
          width: 100%;
          height: 60px;
          background: rgba(10, 15, 30, 0.8);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
        }

        .synthai-nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
        }

        .synthai-nav-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          flex-shrink: 0;
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.4);
        }

        .synthai-nav-wordmark {
          font-size: 17px;
          font-weight: 700;
          color: #f1f5f9;
          letter-spacing: -0.3px;
          font-family: var(--font-geist-sans), system-ui, sans-serif;
        }

        .synthai-nav-badge {
          font-size: 12px;
          font-weight: 600;
          color: #a5b4fc;
          padding: 5px 13px;
          border-radius: 99px;
          border: 1px solid rgba(99, 102, 241, 0.4);
          background: rgba(99, 102, 241, 0.08);
          white-space: nowrap;
          letter-spacing: 0.01em;
          font-family: var(--font-geist-sans), system-ui, sans-serif;
        }

        @media (max-width: 480px) {
          .synthai-nav-badge {
            display: none;
          }
        }
      `}</style>

      <nav className="synthai-nav">
        <a className="synthai-nav-logo" href="/">
          <div className="synthai-nav-icon" aria-hidden="true" />
          <span className="synthai-nav-wordmark">SynthAI</span>
        </a>
        <span className="synthai-nav-badge">3 Models · Claude Evaluator</span>
      </nav>
    </>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
