import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg " +
            "group-[.toaster]:data-[type=success]:bg-green-600 group-[.toaster]:data-[type=success]:text-white group-[.toaster]:data-[type=success]:border-green-700 " +
            "group-[.toaster]:data-[type=error]:bg-red-600 group-[.toaster]:data-[type=error]:text-white group-[.toaster]:data-[type=error]:border-red-700 " +
            "group-[.toaster]:data-[type=warning]:bg-yellow-500 group-[.toaster]:data-[type=warning]:text-white group-[.toaster]:data-[type=warning]:border-yellow-700 " +
            "group-[.toaster]:data-[type=info]:bg-blue-600 group-[.toaster]:data-[type=info]:text-white group-[.toaster]:data-[type=info]:border-blue-700",
          title:
            "group-[.toast]:text-foreground group-data-[type=success]:text-white group-data-[type=error]:text-white group-data-[type=warning]:text-white group-data-[type=info]:text-white",
          description:
            "group-[.toast]:text-muted-foreground group-data-[type=success]:text-white/90 group-data-[type=error]:text-white/90 group-data-[type=warning]:text-white/90 group-data-[type=info]:text-white/90",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
