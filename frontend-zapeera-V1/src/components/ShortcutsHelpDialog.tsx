import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { SHORTCUT_HELP_GROUPS } from "@/lib/keyboard-shortcuts";

/**
 * Shortcuts help overlay — opened with `?` (or the "?" button in the
 * account header). Renders the single-source-of-truth map from
 * lib/keyboard-shortcuts so the list can never drift from the real keys.
 */
export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[20px] p-0 sm:max-w-[560px]">
        <DialogHeader className="shrink-0 bg-[#0a1128] px-5 py-4 text-white">
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold tracking-tight">
            <Keyboard className="h-5 w-5 text-white/70" strokeWidth={2} />
            Keyboard Shortcuts
          </DialogTitle>
          <p className="mt-1 text-xs text-white/60">
            Work the register and the workspace without the mouse. Shortcuts
            never fire while you are typing in a field.
          </p>
        </DialogHeader>

        <div className="space-y-6 px-5 py-4">
          {SHORTCUT_HELP_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#8c95b0]">
                {group.title}
              </h3>
              <dl className="mt-2 divide-y divide-[rgba(15,23,60,0.06)]">
                {group.items.map((item) => (
                  <div
                    key={`${group.title}-${item.keys}-${item.label}`}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <dt className="text-sm font-medium text-[#0a1128]">
                      {item.label}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {item.keys.split(" / ").map((part) => (
                        <Kbd key={part}>{part}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <p className="rounded-[12px] bg-[#f4f6fa] px-3 py-2.5 text-xs leading-relaxed text-[#4a5578]">
            On the Point of Sale screen, <Kbd>Alt+C</Kbd> / <Kbd>Alt+B</Kbd>{" "}
            select Cash / Card tender. <Kbd>Alt+1</Kbd>–<Kbd>Alt+6</Kbd>{" "}
            navigate everywhere, including the register. Every action
            still works with the mouse or touch exactly as before.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
