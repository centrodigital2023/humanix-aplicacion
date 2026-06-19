import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { Mail, Phone, MapPin, Clock } from "lucide-react";
import { useState } from "react";
import { buildSeo } from "@/lib/seo";
import { CONTACT } from "@/lib/social";
import { SocialIcons } from "@/components/humanix/SocialIcons";

export const Route = createFileRoute("/contacto")({
  head: () =>
    buildSeo({
      title: "Contacto · Colombia",
      path: "/contacto",
      description:
        "Ponte en contacto con Humanix. Estamos aquí para responder tus preguntas y escuchar tus sugerencias.",
    }),
  component: ContactoPage,
});

function ContactoPage() {
  const [formData, setFormData] = useState({
    nombre: "",
    email: "",
    asunto: "",
    mensaje: "",
  });
  const [enviado, setEnviado] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Aquí iría la lógica de envío del formulario
    console.log("Formulario enviado:", formData);
    setEnviado(true);
    setTimeout(() => {
      setFormData({ nombre: "", email: "", asunto: "", mensaje: "" });
      setEnviado(false);
    }, 3000);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="pt-24 pb-20">
        <section className="relative overflow-hidden py-12 sm:py-16">
          <div className="absolute inset-0 bg-cyber" />
          <div className="absolute inset-0 bg-aurora opacity-60" />
          <div className="absolute inset-0 grid-pattern opacity-30" />
          <div className="relative mx-auto max-w-4xl px-4 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-biosensor/30 bg-biosensor/10 px-3.5 py-1.5 text-xs font-medium text-biosensor">
              <Mail className="h-3.5 w-3.5" />
              Contacto
            </span>
            <h1 className="mt-4 font-display text-3xl sm:text-5xl font-bold leading-[1.05] text-cyber-foreground">
              ¿Cómo podemos <span className="text-gradient-bio">ayudarte</span>?
            </h1>
            <p className="mt-5 max-w-3xl text-base sm:text-lg text-cyber-foreground/75 leading-relaxed">
              Nos encantaría saber de ti. Nuestro equipo está disponible para responder tus
              preguntas, escuchar tus sugerencias y ayudarte.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 sm:px-6 mt-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Información de Contacto */}
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-6">Información de Contacto</h2>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-biosensor/20 text-biosensor">
                    <Mail className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-foreground mb-1">Email</h3>
                  <p className="text-muted-foreground text-sm">
                    <a
                      href={CONTACT.emailUrl}
                      className="hover:text-biosensor transition-colors"
                    >
                      {CONTACT.email}
                    </a>
                  </p>
                  <p className="text-muted-foreground text-xs mt-1">Respuesta en 24 horas</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-biosensor/20 text-biosensor">
                    <Phone className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-foreground mb-1">WhatsApp / Teléfono</h3>
                  <p className="text-muted-foreground text-sm">
                    <a
                      href={CONTACT.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-biosensor transition-colors"
                    >
                      {CONTACT.phoneDisplay}
                    </a>
                  </p>
                  <p className="text-muted-foreground text-xs mt-1">Atención por WhatsApp 24/7</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-biosensor/20 text-biosensor">
                    <MapPin className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-foreground mb-1">Ubicación</h3>
                  <p className="text-muted-foreground text-sm">Bogotá D.C., Colombia</p>
                  <p className="text-muted-foreground text-xs mt-1">Centro de Operaciones</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-biosensor/20 text-biosensor">
                    <Clock className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-foreground mb-1">Horario</h3>
                  <p className="text-muted-foreground text-sm">
                    Lunes a Viernes: 8:00 AM - 6:00 PM
                    <br />
                    Sábados: 9:00 AM - 2:00 PM
                  </p>
                  <p className="text-muted-foreground text-xs mt-1">Hora Colombia (UTC-5)</p>
                </div>
              </div>

              <div className="pt-6 border-t border-border">
                <h3 className="font-bold text-foreground mb-3">Síguenos en redes</h3>
                <SocialIcons size="md" />
              </div>

              <div className="pt-6 border-t border-border">
                <h3 className="font-bold text-foreground mb-3">Departamentos</h3>
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    <strong>Soporte Técnico:</strong>{" "}
                    <a href="mailto:support@humanix.lat" className="text-biosensor hover:underline">
                      support@humanix.lat
                    </a>
                  </p>
                  <p className="text-muted-foreground">
                    <strong>Prensa:</strong>{" "}
                    <a href="mailto:press@humanix.lat" className="text-biosensor hover:underline">
                      press@humanix.lat
                    </a>
                  </p>
                  <p className="text-muted-foreground">
                    <strong>Empleos:</strong>{" "}
                    <a href="mailto:jobs@humanix.lat" className="text-biosensor hover:underline">
                      jobs@humanix.lat
                    </a>
                  </p>
                  <p className="text-muted-foreground">
                    <strong>Legal:</strong>{" "}
                    <a href="mailto:legal@humanix.lat" className="text-biosensor hover:underline">
                      legal@humanix.lat
                    </a>
                  </p>
                </div>
              </div>
            </div>

            {/* Formulario de Contacto */}
            <div className="rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-[var(--shadow-card)]">
              <h2 className="text-2xl font-bold text-foreground mb-6">Envíanos un mensaje</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="nombre"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Nombre completo
                  </label>
                  <input
                    type="text"
                    id="nombre"
                    name="nombre"
                    value={formData.nombre}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 rounded-lg border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-biosensor"
                    placeholder="Tu nombre"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 rounded-lg border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-biosensor"
                    placeholder="tu@email.com"
                  />
                </div>

                <div>
                  <label
                    htmlFor="asunto"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Asunto
                  </label>
                  <select
                    id="asunto"
                    name="asunto"
                    value={formData.asunto}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-biosensor"
                  >
                    <option value="">Selecciona un asunto</option>
                    <option value="soporte">Soporte técnico</option>
                    <option value="facturacion">Facturación</option>
                    <option value="general">Consulta general</option>
                    <option value="sugerencia">Sugerencia o feedback</option>
                    <option value="asociacion">Oportunidad de asociación</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="mensaje"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Mensaje
                  </label>
                  <textarea
                    id="mensaje"
                    name="mensaje"
                    value={formData.mensaje}
                    onChange={handleChange}
                    required
                    rows={5}
                    className="w-full px-4 py-2 rounded-lg border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-biosensor resize-none"
                    placeholder="Cuéntanos cómo podemos ayudarte..."
                  />
                </div>

                {enviado && (
                  <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm">
                    ✓ Mensaje enviado exitosamente. Pronto nos pondremos en contacto.
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full px-6 py-3 bg-biosensor text-white rounded-lg font-medium hover:bg-biosensor/90 transition-colors focus:outline-none focus:ring-2 focus:ring-biosensor focus:ring-offset-2"
                >
                  Enviar Mensaje
                </button>

                <p className="text-xs text-muted-foreground text-center">
                  Protegemos tu privacidad. Lee nuestra{" "}
                  <a href="/privacidad" className="text-biosensor hover:underline">
                    Política de Privacidad
                  </a>
                  .
                </p>
              </form>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 sm:px-6 mt-16">
          <div className="rounded-3xl border border-border bg-card p-8 text-center">
            <h2 className="text-2xl font-bold text-foreground mb-4">¿Eres profesional de salud?</h2>
            <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
              Si eres médico, enfermero, psicólogo u otro profesional de salud y quieres unirte a
              Humanix, tenemos un proceso de registro especial para ti.
            </p>
            <a
              href="/auth?role=professional&mode=signup"
              className="inline-flex items-center gap-2 px-6 py-3 bg-biosensor text-white rounded-lg font-medium hover:bg-biosensor/90 transition-colors"
            >
              Registrarme como Profesional
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
