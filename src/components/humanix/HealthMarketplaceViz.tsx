import { useEffect, useRef, useState } from "react";
import { Clock, Briefcase, MapPin, Activity, Users, Building2, TrendingUp, Zap } from "lucide-react";

export function HealthMarketplaceViz() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"professional" | "family" | "institution">("professional");

  // Load Leaflet dynamically
  useEffect(() => {
    if (window.L) {
      setLeafletReady(true);
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => setLeafletReady(true);
    document.body.appendChild(script);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current) return;

    const L = window.L;
    const mapInstance = L.map(mapContainerRef.current, {
      center: [4.663, -74.055],
      zoom: 13,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(mapInstance);

    // Professional marker (Blue)
    const professionalIconHtml = `
      <div class="relative flex items-center justify-center" style="width: 44px; height: 44px;">
        <div class="absolute inset-0 bg-blue-500/20 rounded-full animate-pulse"></div>
        <div class="absolute inset-1.5 bg-slate-950 rounded-full border-2 border-blue-500 flex items-center justify-center shadow-lg">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="w-6 h-6">
            <path d="M4 20 C4 15, 8 14, 12 14 C16 14, 20 15, 20 20" stroke="#3b82f6" stroke-width="2.2" stroke-linecap="round" fill="none" />
            <circle cx="12" cy="8" r="3.5" stroke="#3b82f6" stroke-width="2.2" fill="none" />
            <path d="M9.5 12 C9.5 14, 14.5 14, 14.5 12" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round" fill="none" />
            <path d="M12 14 L12 17" stroke="#ef4444" stroke-width="1.8" />
            <circle cx="12" cy="18" r="1.5" fill="#ef4444" />
          </svg>
        </div>
      </div>
    `;

    // Family marker (Yellow)
    const familyIconHtml = `
      <div class="relative flex items-center justify-center" style="width: 44px; height: 44px;">
        <div class="absolute inset-0 bg-yellow-500/20 rounded-full animate-pulse"></div>
        <div class="absolute inset-1.5 bg-slate-950 rounded-full border-2 border-yellow-500 flex items-center justify-center shadow-lg">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="w-6 h-6">
            <circle cx="8" cy="8" r="2.5" stroke="#eab308" stroke-width="1.8" fill="none" />
            <path d="M4 17 C4 14, 7 13.5, 8 13.5 C9 13.5, 12 14, 12 17" stroke="#eab308" stroke-width="1.8" stroke-linecap="round" fill="none" />
            <circle cx="16" cy="9" r="2" stroke="#facc15" stroke-width="1.8" fill="none" />
            <path d="M13 17 C13 14.5, 15 14, 16 14 C17 14, 19 14.5, 19 17" stroke="#facc15" stroke-width="1.8" stroke-linecap="round" fill="none" />
          </svg>
        </div>
      </div>
    `;

    // Institution marker (Purple)
    const institutionIconHtml = `
      <div class="relative flex items-center justify-center" style="width: 44px; height: 44px;">
        <div class="absolute inset-0 bg-purple-500/20 rounded-full animate-pulse"></div>
        <div class="absolute inset-1.5 bg-slate-950 rounded-full border-2 border-purple-500 flex items-center justify-center shadow-lg">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" class="w-6 h-6">
            <path d="M4 20 L4 8 L20 8 L20 20 Z" stroke="#a855f7" stroke-width="1.8" stroke-linecap="round" fill="none" />
            <path d="M9 8 L9 4 L15 4 L15 8" stroke="#a855f7" stroke-width="1.8" stroke-linecap="round" fill="none" />
            <path d="M12 10 L12 14 M10 12 L14 12" stroke="#ef4444" stroke-width="2" stroke-linecap="round" />
          </svg>
        </div>
      </div>
    `;

    L.marker([4.6486, -74.0621], {
      icon: L.divIcon({ html: professionalIconHtml, className: "", iconSize: [44, 44] }),
    }).addTo(mapInstance);

    L.marker([4.6768, -74.0482], {
      icon: L.divIcon({ html: familyIconHtml, className: "", iconSize: [44, 44] }),
    }).addTo(mapInstance);

    L.marker([4.6675, -74.0552], {
      icon: L.divIcon({ html: institutionIconHtml, className: "", iconSize: [44, 44] }),
    }).addTo(mapInstance);

    // Draw connection lines
    const polyline = L.polyline(
      [
        [4.6486, -74.0621],
        [4.6768, -74.0482],
      ],
      {
        color: "#3b82f6",
        weight: 2,
        opacity: 0.6,
        dashArray: "5, 5",
      }
    ).addTo(mapInstance);

    const polyline2 = L.polyline(
      [
        [4.6486, -74.0621],
        [4.6675, -74.0552],
      ],
      {
        color: "#a855f7",
        weight: 2,
        opacity: 0.6,
        dashArray: "5, 5",
      }
    ).addTo(mapInstance);

    return () => {
      mapInstance.remove();
    };
  }, [leafletReady]);

  const roles = [
    {
      id: "professional",
      label: "Profesional",
      color: "from-blue-500 to-blue-600",
      icon: Activity,
      description: "Activa/desactiva disponibilidad como en Uber",
      modalities: [
        { icon: Clock, label: "Por Hora", value: "$65.000 COP" },
        { icon: Clock, label: "Jornada 8h", value: "$340.000 COP" },
        { icon: Briefcase, label: "Jornada 12h", value: "$480.000 COP" },
        { icon: TrendingUp, label: "Mensual", value: "$6.800.000 COP" },
      ],
    },
    {
      id: "family",
      label: "Familia",
      color: "from-yellow-400 to-yellow-500",
      icon: Users,
      description: "Busca y cotiza servicios, propone presupuesto",
      modalities: [
        { icon: Clock, label: "Por Hora", value: "Flexible" },
        { icon: Clock, label: "Jornada 8h", value: "Flexible" },
        { icon: Briefcase, label: "Jornada 12h", value: "Flexible" },
        { icon: TrendingUp, label: "Mensual", value: "Flexible" },
      ],
    },
    {
      id: "institution",
      label: "IPS / EPS",
      color: "from-purple-500 to-indigo-600",
      icon: Building2,
      description: "Publica vacantes, busca profesionales",
      modalities: [
        { icon: Clock, label: "Por Hora", value: "Presupuesto" },
        { icon: Clock, label: "Jornada 8h", value: "Presupuesto" },
        { icon: Briefcase, label: "Jornada 12h", value: "Presupuesto" },
        { icon: TrendingUp, label: "Mensual", value: "Presupuesto" },
      ],
    },
  ];

  const activeRole = roles.find((r) => r.id === selectedRole)!;
  const RoleIcon = activeRole.icon;

  return (
    <section className="py-24 sm:py-32 relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3.5 py-1.5 text-xs font-medium text-purple-400 mb-4">
            <Zap className="h-3.5 w-3.5" />
            Marketplace de Salud en Tiempo Real
          </div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold leading-tight mb-4">
            Uber para <span className="text-gradient-bio">talento en salud</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Tres actores. Un sistema. Match automático basado en oferta, demanda y geolocalización en vivo.
          </p>
        </div>

        {/* Interactive Map + Modalities */}
        <div className="grid lg:grid-cols-3 gap-8 mb-12">
          {/* Map Column */}
          <div className="lg:col-span-2">
            <div
              ref={mapContainerRef}
              className="w-full h-96 bg-slate-950 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden"
              style={{ minHeight: "384px" }}
            />
            <p className="text-xs text-slate-500 mt-3 text-center">
              Geolocalización en vivo • Matching en &lt;10km • Pagos directos inmediatos
            </p>
          </div>

          {/* Role Modalities Column */}
          <div className="space-y-4">
            {/* Role Buttons */}
            <div className="space-y-2">
              {roles.map((role) => {
                const RoleButtonIcon = role.icon;
                return (
                  <button
                    key={role.id}
                    onClick={() => setSelectedRole(role.id as any)}
                    className={`w-full p-4 rounded-2xl border-2 transition-all duration-200 ${
                      selectedRole === role.id
                        ? `border-current bg-gradient-to-r ${role.color} text-white shadow-lg`
                        : "border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <RoleButtonIcon className="h-5 w-5" />
                      <div className="text-left">
                        <p className="font-bold text-sm">{role.label}</p>
                        <p className="text-xs opacity-75">{role.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Modalities Display */}
            <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4 space-y-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">4 Modalidades de Pago</p>
              {activeRole.modalities.map((mod) => {
                const ModIcon = mod.icon;
                return (
                  <div key={mod.label} className="flex items-center justify-between p-2 bg-slate-900/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <ModIcon className="h-4 w-4 text-slate-500" />
                      <span className="text-xs font-medium text-slate-300">{mod.label}</span>
                    </div>
                    <span className="text-xs font-bold text-white">{mod.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* How It Works - Flow */}
        <div className="mt-20 pt-12 border-t border-slate-800">
          <h3 className="text-2xl font-bold mb-8 text-center">Cómo funciona el matching</h3>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              {
                step: "1",
                title: "Familia / IPS solicita",
                desc: "Define especialidad, fecha, hora y zona geográfica",
              },
              {
                step: "2",
                title: "Sistema busca",
                desc: "Algoritmo IA evalúa 847+ profesionales verificados",
              },
              {
                step: "3",
                title: "Match en tiempo real",
                desc: "Profesional más cercano recibe alerta en <10km",
              },
              {
                step: "4",
                title: "Pago inmediato",
                desc: "Transacción directa a Nequi/PSE al completar",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="relative p-6 rounded-2xl border border-slate-800 bg-slate-950/50 hover:border-slate-600 transition-colors"
              >
                <div className="absolute -top-4 -left-4 w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold text-xs">
                  {item.step}
                </div>
                <h4 className="font-bold text-sm mt-2">{item.title}</h4>
                <p className="text-xs text-slate-400 mt-2">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
