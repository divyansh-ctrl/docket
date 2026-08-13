import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Check, Copy, Monitor, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopApi, isBrowserPreview, terminalEvents, type ProviderId } from "./bridge";

type TerminalSurfaceProps = {
  terminalId: string;
  provider: ProviderId;
  command: string;
  purpose: "login" | "session";
  interactive: boolean;
  onError: (message: string) => void;
};

const transcriptLimit = 24_000;

function terminalText(data: string) {
  let output = "";
  let state: "text" | "escape" | "csi" | "osc" | "osc-escape" = "text";

  for (const character of data) {
    const code = character.charCodeAt(0);

    if (state === "text") {
      if (code === 27) {
        state = "escape";
      } else if (code === 8) {
        output = output.slice(0, -1);
      } else if (code === 13) {
        continue;
      } else if (code === 9 || code === 10 || code >= 32) {
        output += character;
      }
      continue;
    }

    if (state === "escape") {
      if (character === "[") state = "csi";
      else if (character === "]") state = "osc";
      else state = "text";
      continue;
    }

    if (state === "csi") {
      if (code >= 64 && code <= 126) state = "text";
      continue;
    }

    if (state === "osc") {
      if (code === 7) state = "text";
      else if (code === 27) state = "osc-escape";
      continue;
    }

    if (state === "osc-escape") {
      state = character === "\\" ? "text" : "osc";
    }
  }

  return output;
}

export function TerminalSurface({
  terminalId,
  provider,
  command,
  purpose,
  interactive,
  onError,
}: TerminalSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [transcript, setTranscript] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      cursorStyle: "bar",
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.35,
      minimumContrastRatio: 4.5,
      scrollback: 2_000,
      tabStopWidth: 4,
      theme: {
        background: "#0e141b",
        foreground: "#e7edf2",
        cursor: "#c2a4ff",
        cursorAccent: "#0e141b",
        selectionBackground: "#43536a",
        black: "#1b2530",
        red: "#ff8b9a",
        green: "#72d5b3",
        yellow: "#f1c365",
        blue: "#8dbbff",
        magenta: "#c2a4ff",
        cyan: "#6dcbd1",
        white: "#e7edf2",
        brightBlack: "#718091",
        brightRed: "#ffadb8",
        brightGreen: "#9be3c9",
        brightYellow: "#f7d78e",
        brightBlue: "#b3d2ff",
        brightMagenta: "#d9c7ff",
        brightCyan: "#9ce0e4",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);

    if (isBrowserPreview) {
      terminal.writeln("\u001b[1;33mBROWSER PREVIEW — NO PROVIDER PROCESS OR CREDENTIAL\u001b[0m");
    }

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (event.metaKey && event.key.toLocaleLowerCase() === "c") {
        if (terminal.hasSelection()) {
          void navigator.clipboard.writeText(terminal.getSelection()).catch(() => {
            onError("The selected terminal text could not be copied.");
          });
        }
        return false;
      }
      return true;
    });

    const inputDisposable = terminal.onData((data) => {
      if (!interactive) return;
      void desktopApi.terminal.write(terminalId, data).catch((error: unknown) => {
        onError(error instanceof Error ? error.message : "Terminal input could not be forwarded.");
      });
    });

    const unsubscribeData = terminalEvents.subscribeData(terminalId, (event) => {
      terminal.write(event.data);
      const plain = terminalText(event.data);
      if (plain) {
        setTranscript((current) => `${current}${plain}`.slice(-transcriptLimit));
      }
    });

    let resizeFrame = 0;
    const fit = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          void desktopApi.terminal
            .resize(terminalId, terminal.cols, terminal.rows)
            .catch((error: unknown) => {
              onError(error instanceof Error ? error.message : "Terminal resize failed.");
            });
        } catch {
          // The host can briefly report zero dimensions during a panel transition.
        }
      });
    };
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(host);
    fit();
    terminal.focus();

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      unsubscribeData();
      inputDisposable.dispose();
      fitAddon.dispose();
      terminal.dispose();
    };
  }, [interactive, onError, terminalId]);

  async function copyTranscript() {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      onError("The accessible terminal transcript could not be copied.");
    }
  }

  return (
    <div className="xtermSurface">
      <div className="xtermContext">
        <span>
          <ShieldAlert size={14} aria-hidden="true" />
          {purpose === "login" ? "Purpose-bound" : "Fresh"} {provider === "codex" ? "Codex" : "Claude"}{" "}
          {purpose === "login" ? "login" : "controller session"}
        </span>
        <code>{command}</code>
      </div>
      {isBrowserPreview ? (
        <div className="xtermPreviewNotice" role="status">
          <Monitor size={14} aria-hidden="true" />
          Simulated browser preview · no CLI process, credential, provider call, attach, or resume
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="xtermHost"
        aria-label={`${provider === "codex" ? "Codex" : "Claude"} ${purpose} terminal${interactive ? "" : ", read only"}`}
      />
      <details className="terminalTranscript">
        <summary>Accessible transcript</summary>
        <div className="terminalTranscriptHeader">
          <span>ANSI-free text copy. Terminal input is never persisted here.</span>
          <button type="button" disabled={!transcript} onClick={() => void copyTranscript()}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre tabIndex={0} aria-label="Accessible terminal transcript" aria-live="off">
          {transcript || "No provider output yet."}
        </pre>
      </details>
    </div>
  );
}
