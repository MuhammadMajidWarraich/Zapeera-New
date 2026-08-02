import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Phone,
  MessageCircle,
  Mail,
  BookOpen,
  HelpCircle,
  ShieldCheck,
  FileText,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { config } from "@/lib/config";
import { whatsappUrl, callUrl, emailUrl, SUPPORT_PHONE_DISPLAY } from "@/lib/support-links";
import { cn } from "@/lib/utils";

const FAQS = [
  { q: "How do I create a new business?", a: "From your dashboard, click \"Create New Business\" and fill in the business details. You'll be able to open its workspace right away." },
  { q: "How do I join a business I was invited to?", a: "Open the Invitations page from the sidebar and click Accept on the invitation. The business will appear under My Businesses." },
  { q: "How does the desktop app sync my data?", a: "The desktop app works offline and syncs automatically whenever you're online. Check Desktop Status on the Profile & Security page to see the last sync time." },
  { q: "What payment methods are accepted for plans?", a: "Contact our billing team on WhatsApp or email and they'll walk you through available payment methods." },
  { q: "How do I reset my password?", a: "Use the \"Forgot Password\" option on the login screen — we'll send a reset link to your email." },
];

const SupportPage = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(FAQS[0].q);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-7">
        <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
          <HelpCircle className="h-3.5 w-3.5" />
          Support
        </div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Support Center</h1>
        <p className="mt-1 text-sm text-[#8c95b0]">Get help with your account, businesses and the Zapeera apps.</p>
      </div>

      {/* Contact cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <a
          href={callUrl()}
          className="group rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
        >
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white">
            <Phone className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold text-[#0a1128]">Call Us</h3>
          <p className="mt-0.5 text-[13px] text-[#8c95b0]">{SUPPORT_PHONE_DISPLAY}</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1a52c5] group-hover:underline">
            Start a call <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </a>
        <a
          href={whatsappUrl("Hello! I need support with Zapeera.")}
          target="_blank"
          rel="noopener noreferrer"
          className="group rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
        >
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-green-500 text-white">
            <MessageCircle className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold text-[#0a1128]">WhatsApp</h3>
          <p className="mt-0.5 text-[13px] text-[#8c95b0]">Chat with our support team</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-green-600 group-hover:underline">
            Open chat <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </a>
        <a
          href={emailUrl("Zapeera Support", "Hello, I need help with Zapeera.")}
          className="group rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
        >
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#1a52c5]/10 text-[#1a52c5]">
            <Mail className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold text-[#0a1128]">Email</h3>
          <p className="mt-0.5 truncate text-[13px] text-[#8c95b0]">{config.support.email}</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1a52c5] group-hover:underline">
            Send email <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </a>
        <div className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] p-5">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold text-[#0a1128]">Business Help</h3>
          <p className="mt-0.5 text-[13px] text-[#8c95b0]">Feature guides inside your workspace</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1a52c5]">
            <BookOpen className="h-3.5 w-3.5" /> In-app docs
          </span>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* FAQ */}
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-[18px] font-extrabold tracking-tight text-[#0a1128]">Frequently Asked Questions</h2>
          <div className="overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            {FAQS.map((faq) => {
              const isOpen = open === faq.q;
              return (
                <div key={faq.q} className="border-b border-[rgba(15,23,60,0.06)] last:border-0">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : faq.q)}
                    className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
                  >
                    <span className="text-[15px] font-semibold text-[#0a1128]">{faq.q}</span>
                    <ChevronRight className={cn("h-4 w-4 shrink-0 text-[#8c95b0] transition-transform", isOpen && "rotate-90")} />
                  </button>
                  {isOpen && <p className="px-6 pb-4 text-[13px] leading-relaxed text-[#4a5578]">{faq.a}</p>}
                </div>
              );
            })}
          </div>
        </section>

        {/* Resources */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-2.5 text-[16px] font-bold text-[#0a1128]">
              <ShieldCheck className="h-5 w-5 text-[#1a52c5]" />
              Account & Security
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-[#8c95b0]">
              Manage your password, profile and security settings from the Profile & Security page.
            </p>
            <a
              href="#/settings"
              onClick={(e) => {
                e.preventDefault();
                navigate("/settings");
              }}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white px-4 py-2.5 text-sm font-semibold text-[#0a1128] transition-colors hover:bg-[#f0f2f7]"
            >
              <FileText className="h-4 w-4 text-[#1a52c5]" />
              Open Profile & Security
            </a>
          </section>

          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-gradient-to-br from-[#1a52c5]/[0.04] to-[#28c2ce]/[0.04] p-6">
            <h3 className="text-[15px] font-bold text-[#0a1128]">Still stuck?</h3>
            <p className="mt-1 text-[13px] text-[#8c95b0]">
              Reach out on WhatsApp — our support team typically responds within a few hours.
            </p>
            <a
              href={whatsappUrl("Hello! I need help with Zapeera.")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-green-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,197,94,0.3)] hover:opacity-95"
            >
              <MessageCircle className="h-4 w-4" />
              Chat on WhatsApp
            </a>
          </section>
        </div>
      </div>
    </main>
  );
};

export default SupportPage;
