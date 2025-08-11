
import { jsPDF } from "jspdf";

const { useState, useEffect, useMemo, useRef } = React;

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return await res.json();
}

function Header({ meta }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl md:text-3xl font-semibold">Barista CX Bot <span className="text-sm opacity-70">v{meta?.version || "1.0"}</span></h1>
      <p className="opacity-75">Learn & assess LEAST, empowerment, escalation. All barista scope. Exports a report after each attempt.</p>
    </header>
  );
}

function ScenarioPicker({ scenarios, selectedId, onSelect }) {
  return (
    <div className="card rounded-2xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Scenarios</h2>
        <span className="pill px-3 py-1 rounded-full text-xs opacity-80">Total: {scenarios.length}</span>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {scenarios.map(s => (
          <button key={s.id}
            onClick={() => onSelect(s.id)}
            className={"text-left card rounded-xl p-4 hover:ring-2 hover:ring-indigo-400 " + (selectedId===s.id ? "ring-2 ring-indigo-400" : "")}>
            <div className="flex items-center justify-between">
              <div className="font-medium">{s.title}</div>
              <span className="badge text-xs px-2 py-0.5 rounded-full">L{String(s.level)}</span>
            </div>
            <div className="text-xs opacity-70 mt-1">{s.trigger}</div>
            <div className="text-[11px] opacity-50 mt-1">Tags: {s.tags?.join(", ")}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

const KEYWORDS = {
  listen: ["could you tell me", "may i know", "what happened", "help me understand", "can you share"],
  empathize: ["i understand", "that wasn't ideal", "i get it", "i know this is frustrating", "i see how"],
  apologize: ["i'm sorry", "i am sorry", "we're sorry", "we are sorry", "apologize"],
  solutionize: [
    "let me replace", "i'll replace", "allow me to replace", "i will replace",
    "i'll check your kot", "let me check your kot", "i'll get it out", "i will fix it", "i'll fix it now"
  ],
  thank: ["thank you", "thanks", "appreciate your patience", "we appreciate"],
  escalation: ["manager", "mod", "supervisor"],
  forbidden_refund: ["refund", "discount", "compensate", "100% off", "credit note"],
  aggregator_route: ["raise the request through the app", "through the app you ordered", "in the app you ordered"]
};

function analyzeUtterance(text) {
  const t = text.toLowerCase();
  const hit = (arr) => arr.some(k => t.includes(k));
  return {
    listen: hit(KEYWORDS.listen),
    empathize: hit(KEYWORDS.empathize),
    apologize: hit(KEYWORDS.apologize),
    solutionize: hit(KEYWORDS.solutionize),
    thank: hit(KEYWORDS.thank),
    escalation: hit(KEYWORDS.escalation),
    forbidden_refund: hit(KEYWORDS.forbidden_refund),
    aggregator_route: hit(KEYWORDS.aggregator_route)
  };
}

function Chat({ scenario, rubric, hints, missteps, onFinish }) {
  const [messages, setMessages] = useState([
    { role: "system", text: `Scenario: ${scenario.title}\n${scenario.trigger}` }
  ]);
  const [input, setInput] = useState("");
  const [stats, setStats] = useState({
    listen:false, empathize:false, apologize:false, solutionize:false, thank:false,
    escalation:false, forbidden_refund:false, aggregator_route:false
  });

  const startTime = useRef(Date.now());

  function send() {
    if (!input.trim()) return;
    const analysis = analyzeUtterance(input);
    const nextStats = { ...stats };
    for (const k of Object.keys(analysis)) nextStats[k] = stats[k] || analysis[k];
    setStats(nextStats);
    setMessages(prev => [...prev, { role: "user", text: input }]);
    setInput("");
  }

  function scoreNow() {
    const w = rubric.weights;
    const p = rubric.penalties;

    let score = 0;
    if (stats.listen || stats.empathize || stats.apologize) score += w.recognition_tone;

    let leastCount = 0;
    ["listen","empathize","apologize","solutionize","thank"].forEach(k => leastCount += stats[k] ? 1 : 0);
    score += (leastCount / 5) * w.least;

    if (!stats.forbidden_refund) score += w.empowerment;

    const needsEscalation = (scenario.expected.empowerment === "escalate_mod") || (scenario.escalate_if?.length > 0 && scenario.level >= 2);
    if (needsEscalation) {
      if (stats.escalation) score += w.escalation;
    } else {
      score += w.escalation;
    }

    if (stats.empathize && stats.apologize) score += w.script_quality;
    if (stats.solutionize) score += w.ops_followthrough;

    let penalties = 0;
    if (stats.forbidden_refund) penalties += p.refund_discount_promise;
    if (scenario.tags?.includes("aggregator")) {
      if (!stats.aggregator_route) penalties += p.aggregator_misroute;
    }

    score = Math.max(0, Math.min(100, Math.round(score - penalties)));

    const band = score >= rubric.pass_threshold ? "PASS" : (score >= rubric.bands.coach_me[0] ? "COACH-ME" : "REDO");

    const durationSec = Math.round((Date.now() - startTime.current)/1000);

    const report = {
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      timestamp: new Date().toISOString(),
      durationSec,
      score,
      band,
      breakdown: {
        recognition_tone: stats.listen||stats.empathize||stats.apologize,
        LEAST: {
          listen: stats.listen, empathize: stats.empathize, apologize: stats.apologize,
          solutionize: stats.solutionize, thank: stats.thank
        },
        empowerment_ok: !stats.forbidden_refund,
        escalation_mentioned: stats.escalation,
        aggregator_route: stats.aggregator_route
      },
      missteps: [
        ...(stats.forbidden_refund ? [{ key:"refund_offer", ...missteps.library.refund_offer }] : []),
        ...(scenario.tags?.includes("aggregator") && !stats.aggregator_route ? [{ key:"aggregator_misroute", ...missteps.library.aggregator_misroute }] : []),
      ],
      goldScript: scenario.gold_script || [],
      nextChecklist: suggestNextChecklist(stats, scenario)
    };

    onFinish(report, messages);
  }

  function suggestNextChecklist(stats, scenario) {
    const out = [];
    if (!stats.empathize) out.push("Add one empathy line early.");
    if (!stats.apologize) out.push("Include a clean apology (no legal repeat).");
    if (!stats.solutionize) out.push("Offer the fix that’s within barista empowerment.");
    if (!stats.thank) out.push("Close with a thank-you/assurance.");
    if (scenario.tags?.includes("aggregator") && !stats.aggregator_route) out.push("Politely route via app for aggregator orders.");
    if (out.length === 0) out.push("Great flow. Add timing or concrete follow-up next time.");
    return out.slice(0,3);
  }

  return (
    <div className="card rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Assessment</h3>
        <button className="btn px-3 py-1 rounded-lg text-sm" onClick={scoreNow}>Finish & Score</button>
      </div>
      <div className="h-64 overflow-auto space-y-3 mb-3 p-3 rounded-xl bg-black/20">
        {messages.map((m,i) => (
          <div key={i} className={"max-w-[80%] " + (m.role==="user" ? "ml-auto text-right" : "")}>
            <div className={"inline-block px-3 py-2 rounded-xl " + (m.role==="user" ? "bg-indigo-600/30" : "bg-slate-600/20")}>
              <pre className="whitespace-pre-wrap font-sans text-sm">{m.text}</pre>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="flex-1 px-3 py-2 rounded-lg bg-black/30 outline-none" placeholder="Type your response..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') send();}} />
        <button className="btn px-4 py-2 rounded-lg" onClick={send}>Send</button>
      </div>
    </div>
  );
}

function ReportPanel({ report, onDownloadJSON, onDownloadPDF }) {
  if (!report) return null;
  return (
    <div className="card rounded-2xl p-4 mt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Session Report</h3>
        <div className="flex gap-2">
          <button className="btn px-3 py-1 rounded-lg text-sm" onClick={onDownloadJSON}>Download JSON</button>
          <button className="btn px-3 py-1 rounded-lg text-sm" onClick={onDownloadPDF}>Download PDF</button>
        </div>
      </div>
      <div className="text-sm opacity-80 mt-2">
        <div><span className="opacity-60">Scenario:</span> {report.scenarioTitle}</div>
        <div><span className="opacity-60">Score:</span> {report.score} <span className="pill px-2 py-0.5 rounded-full ml-2">{report.band}</span></div>
        <div className="mt-2"><span className="opacity-60">Next Attempt Checklist:</span>
          <ul className="list-disc ml-6 mt-1">
            {report.nextChecklist.map((c,i)=>(<li key={i}>{c}</li>))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [report, setReport] = useState(null);

  useEffect(() => {
    (async () => {
      const scenarios = await fetchJSON("./content/scenarios.json");
      const rubric = await fetchJSON("./content/rubric.json");
      const hints = await fetchJSON("./content/hints.json");
      const missteps = await fetchJSON("./content/missteps.json");
      setData({ scenarios, rubric, hints, missteps });
      setSelectedId(scenarios.scenarios[0].id);
    })().catch(err => {
      console.error(err);
      alert("Failed to load content. Check /content files.");
    });
  }, []);

  const selectedScenario = useMemo(() => {
    if (!data) return null;
    return data.scenarios.scenarios.find(s => s.id === selectedId);
  }, [data, selectedId]);

  function onFinish(reportObj, messages) {
    const fullReport = {
      ...reportObj,
      messages
    };
    setReport(fullReport);
  }

  function downloadJSON() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replaceAll(":","-");
    a.download = `cx_session_${report.scenarioId}_${ts}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadPDF() {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    let y = margin;

    function line(t, size=12, bold=false) {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(t, 515);
      for (const L of lines) {
        doc.text(L, margin, y);
        y += size + 4;
      }
      y += 2;
    }

    line("Barista CX Bot — Session Report", 16, true);
    line(`Scenario: ${report.scenarioTitle}`, 12, true);
    line(`Score: ${report.score}  |  Band: ${report.band}`, 12);
    line(`Timestamp: ${report.timestamp}`, 10);
    line(`Duration: ${report.durationSec}s`, 10);
    y += 6;

    line("Breakdown:", 12, true);
    line(JSON.stringify(report.breakdown, null, 2), 9);

    if (report.missteps?.length) {
      line("Missteps & Fixes:", 12, true);
      report.missteps.forEach(m => {
        line(`• ${m.key}: ${m.explain}`, 10);
        line(`  Fix: ${m.fix}`, 10);
      });
    }

    if (report.goldScript?.length) {
      line("Gold Script:", 12, true);
      report.goldScript.forEach(g => line(`• ${g}`, 10));
    }

    if (report.nextChecklist?.length) {
      line("Next Attempt Checklist:", 12, true);
      report.nextChecklist.forEach(n => line(`• ${n}`, 10));
    }

    doc.save(`cx_session_${report.scenarioId}_${new Date().toISOString().replaceAll(":","-")}.pdf`);
  }

  if (!data) {
    return <div className="opacity-80">Loading content…</div>;
  }

  return (
    <main>
      <Header meta={data.scenarios.meta} />
      <ScenarioPicker
        scenarios={data.scenarios.scenarios}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selectedScenario && (
        <Chat
          scenario={selectedScenario}
          rubric={data.rubric}
          hints={data.hints}
          missteps={data.missteps}
          onFinish={onFinish}
        />
      )}
      <ReportPanel
        report={report}
        onDownloadJSON={downloadJSON}
        onDownloadPDF={downloadPDF}
      />
      <footer className="mt-10 text-xs opacity-50">Third Wave Coffee — Barista CX Training • LEAST • Empowerment • GitHub Pages ready</footer>
    </main>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
