import { Laptop, Monitor, ShieldCheck, CheckCircle2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useRuntime } from "@/lib/runtime";
import { Button } from "@/components/ui/button";

const DownloadsPage = () => {
  const navigate = useNavigate();
  const runtime = useRuntime();
  const isDesktop = runtime.isDesktop;

  const steps = [
    { title: "Download the app", body: "Get the Zapeera desktop installer for Windows from the button above." },
    { title: "Install & sign in", body: "Run the installer and sign in with your existing Zapeera account." },
    { title: "Provision your business", body: "Choose a business to download locally so you can work offline." },
    { title: "Automatic sync", body: "Zapeera keeps everything in sync whenever you're back online." },
  ];

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-7">
        <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
          <Laptop className="h-3.5 w-3.5" />
          Desktop
        </div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Download the Zapeera Desktop App</h1>
        <p className="mt-1 text-sm text-[#8c95b0]">Work offline, sync automatically, and manage your businesses from anywhere.</p>
      </div>

      {isDesktop ? (
        <div className="rounded-2xl border border-green-500/15 bg-green-500/[0.06] p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-600" />
            <div>
              <h3 className="text-[16px] font-bold text-[#0a1128]">You're running the desktop app</h3>
              <p className="mt-1 text-[13px] text-[#4a5578]">
                This is the Zapeera desktop app. Check your sync status on the Profile & Security page.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
          <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
            <div className="flex flex-col justify-center gap-4 p-8">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_8px_24px_rgba(26,82,197,0.35)]">
                <Monitor className="h-8 w-8" />
              </div>
              <h2 className="text-[22px] font-extrabold tracking-tight text-[#0a1128]">Zapeera for Windows</h2>
              <p className="text-[14px] leading-relaxed text-[#8c95b0]">
                Run your business even without internet. Sales, inventory and more stay on your machine and sync when you're back online.
              </p>
              <Button
                onClick={() => (window.location.href = "mailto:support@zapeera.com?subject=Desktop%20app%20download")}
                className="h-12 w-fit rounded-[12px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-7 font-semibold text-white shadow-[0_4px_20px_rgba(26,82,197,0.3)] hover:-translate-y-px hover:shadow-[0_8px_32px_rgba(26,82,197,0.4)]"
              >
                <Laptop className="mr-2 h-4 w-4" />
                Request Download Link
              </Button>
            </div>
            <div className="border-t border-[rgba(15,23,60,0.06)] bg-[#f8fafc] p-8 md:border-l md:border-t-0">
              <h3 className="mb-4 flex items-center gap-2 text-[15px] font-bold text-[#0a1128]">
                <ShieldCheck className="h-4 w-4 text-[#1a52c5]" />
                Why use the desktop app?
              </h3>
              <ul className="space-y-3">
                {[
                  "Work fully offline — no internet needed",
                  "Automatic two-way sync with the cloud",
                  "Faster local performance for daily operations",
                  "Your data stays encrypted in transit",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[13px] text-[#4a5578]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* How it works */}
      <h2 className="mb-3 mt-8 text-[18px] font-extrabold tracking-tight text-[#0a1128]">How it works</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.title} className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[15px] font-extrabold text-[#1a52c5]">
              {i + 1}
            </div>
            <h3 className="text-[14px] font-bold text-[#0a1128]">{s.title}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-[#8c95b0]">{s.body}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => navigate("/zapeera")}
        className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1a52c5] transition-colors hover:text-[#28c2ce]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </button>
    </main>
  );
};

export default DownloadsPage;
