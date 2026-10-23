import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallAppButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const completed = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", completed);
    return () => {
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", completed);
    };
  }, []);
  async function install() {
    if (!prompt) {
      setHelp(true);
      return;
    }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPrompt(null);
  }
  if (installed) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void install()}>
        <Download className="mr-1.5 h-4 w-4" />
        <span>Instalar app</span>
      </Button>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Instalar Humanix</DialogTitle>
            <DialogDescription>
              Abre humanix.lat directamente en tu navegador, fuera de esta vista previa.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {ios
              ? "En Safari, toca Compartir y luego Añadir a pantalla de inicio."
              : "En Chrome o Edge, abre el menú y elige Instalar aplicación o Añadir a pantalla de inicio."}
          </p>
          {ios && <Share className="h-5 w-5 text-primary" />}
          <Button asChild>
            <a href="https://humanix.lat/instalar" target="_blank" rel="noopener noreferrer">
              Abrir Humanix
            </a>
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
