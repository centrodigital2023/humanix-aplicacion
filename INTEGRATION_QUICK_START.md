# 🔗 GUÍA RÁPIDA DE INTEGRACIÓN - HUMANIX CARE CONNECT

## Imports Disponibles

### 1. Módulos de Institución

```typescript
// Ofertas masivas con requisitos
import { EnhancedBulkOffersModule } from "@/components/humanix/EnhancedBulkOffersModule";

// Gestión de pacientes y casos
import { EnhancedPatientsModule } from "@/components/humanix/EnhancedPatientsModule";

// Agenda de turnos
import { EnhancedAgendaModule } from "@/components/humanix/EnhancedAgendaModule";

// Reportes + CRM
import { EnhancedReportsWithCRMModule } from "@/components/humanix/EnhancedReportsWithCRMModule";

// Perfil de institución
import { SmartInstitutionProfileForm } from "@/components/humanix/SmartInstitutionProfileForm";

// Constructor de formularios dinámicos
import { DynamicFormsBuilder } from "@/components/humanix/DynamicFormsBuilder";
```

---

## Uso en Dashboard Institución

### Actualizar `src/routes/dashboard.institucion.tsx`

```tsx
// Reemplazar imports antiguos
import {
  BulkOffersModule,     // ← VIEJO
  PatientsModule,       // ← VIEJO
  AgendaModule,         // ← VIEJO
  ReportsModule,        // ← VIEJO
} from "@/components/humanix/InstitutionModules";

// Por los nuevos
import { EnhancedBulkOffersModule } from "@/components/humanix/EnhancedBulkOffersModule";
import { EnhancedPatientsModule } from "@/components/humanix/EnhancedPatientsModule";
import { EnhancedAgendaModule } from "@/components/humanix/EnhancedAgendaModule";
import { EnhancedReportsWithCRMModule } from "@/components/humanix/EnhancedReportsWithCRMModule";

// En los TabsContent:
<TabsContent value="resumen" className="space-y-8 mt-4">
  {/* ... existing summary content ... */}
</TabsContent>

<TabsContent value="bulk">
  <EnhancedBulkOffersModule 
    userId={user.id} 
    defaultCity={userCity}
  />
</TabsContent>

<TabsContent value="pacientes">
  <EnhancedPatientsModule userId={user.id} />
</TabsContent>

<TabsContent value="agenda">
  <EnhancedAgendaModule userId={user.id} />
</TabsContent>

<TabsContent value="reportes">
  <EnhancedReportsWithCRMModule userId={user.id} />
</TabsContent>
```

---

## Crear Nueva Ruta: Perfil Institución

### Crear `src/routes/institution.profile.tsx`

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { SmartInstitutionProfileForm } from "@/components/humanix/SmartInstitutionProfileForm";
import { useAppUser } from "@/hooks/use-app-user";
import { AppShell } from "@/components/humanix/AppShell";
import { LayoutDashboard } from "lucide-react";

export const Route = createFileRoute("/institution/profile")({
  head: () => ({ meta: [{ title: "Perfil institución · Humanix" }] }),
  component: InstitutionProfilePage,
});

function InstitutionProfilePage() {
  const { user, loading } = useAppUser({ allow: ["institution"] });

  if (loading || !user) return <div>Cargando...</div>;

  return (
    <AppShell
      user={user}
      nav={[
        { label: "Dashboard", to: "/dashboard/institucion", icon: LayoutDashboard },
        { label: "Perfil", to: "/institution/profile", icon: Building2 },
      ]}
      title="Perfil de institución"
      subtitle="Información oficial y documentación"
    >
      <SmartInstitutionProfileForm userId={user.id} />
    </AppShell>
  );
}
```

---

## Agregar Formularios Dinámicos a Ofertas

### En la página de detalles de oferta

```tsx
import { DynamicFormsBuilder } from "@/components/humanix/DynamicFormsBuilder";

// En el componente de detalles de oferta
<div className="space-y-6">
  {/* Contenido existente de oferta... */}
  
  {/* Nuevo: Constructor de formularios */}
  <section>
    <h2 className="text-xl font-bold mb-3">Formulario personalizado</h2>
    <DynamicFormsBuilder 
      offerId={offer.id} 
      userId={user.id}
    />
  </section>
</div>
```

---

## Base de Datos - Tablas Nuevas

### Para TypeScript, regenerar tipos:

```bash
supabase gen types typescript > src/integrations/supabase/types.ts
```

### O manualmente, agregar tipos para:

```typescript
// institution_documents
type InstitutionDocument = {
  id: string;
  user_id: string;
  doc_type: 'nit_certificate' | 'chamber_of_commerce' | 'legal_verification' | 'compliance_report';
  file_name: string;
  file_url: string;
  status: 'pending' | 'approved' | 'rejected';
  ai_score?: number;
  ai_verified?: boolean;
  expires_at?: string;
};

// job_offer_requirements
type JobOfferRequirement = {
  id: string;
  job_offer_id: string;
  requirement_type: 'background_check' | 'police_check' | 'prosecutor_check' | 'medical_exam' | 'certification' | 'reference';
  description?: string;
  is_mandatory: boolean;
  priority: number;
};

// crm_contacts
type CRMContact = {
  id: string;
  organization_id: string;
  contact_name: string;
  contact_email?: string;
  contact_phone?: string;
  company_name?: string;
  segment: string;
  status: 'active' | 'inactive' | 'churned';
  tags: string[];
  notes?: string;
};

// crm_campaigns
type CRMCampaign = {
  id: string;
  organization_id: string;
  campaign_name: string;
  campaign_type: 'email' | 'sms' | 'whatsapp';
  status: 'draft' | 'scheduled' | 'sent';
  segment?: string;
  open_rate?: number;
  click_rate?: number;
  conversion_rate?: number;
};
```

---

## Características por Módulo

### 📦 EnhancedBulkOffersModule
- [x] Publicar múltiples ofertas simultáneamente
- [x] Agregar requisitos (antecedentes, policía, procuraduría, etc.)
- [x] Matching IA automático
- [x] Descargar carpeta documental con FUID
- [x] Validación de cumplimiento

### 👥 EnhancedPatientsModule
- [x] Ver pacientes/casos activos
- [x] Historial de servicios
- [x] Notas médicas y coordinación
- [x] Asignar coordinadores
- [x] KPIs de pacientes

### 📅 EnhancedAgendaModule
- [x] Calendario de 7 días
- [x] Estados de turno (scheduled, confirmed, completed, no-show)
- [x] Recordatorios por WhatsApp
- [x] Exportar agenda en CSV
- [x] Alertas configurables

### 📊 EnhancedReportsWithCRMModule
- [x] Dashboard de métricas
- [x] Gestión de contactos con segmentación IA
- [x] Campañas Resend (Email/SMS/WhatsApp)
- [x] Análisis de rendimiento
- [x] 6 segmentos predefinidos

### 🏢 SmartInstitutionProfileForm
- [x] Formulario con validación automática
- [x] NIT y cámara de comercio
- [x] Upload de documentos
- [x] Barra de cumplimiento FUID
- [x] Validación por IA

### 📝 DynamicFormsBuilder
- [x] 8 tipos de campo (texto, email, textarea, select, radio, checkbox, date, file)
- [x] 3 plantillas rápidas
- [x] Gestión de respuestas
- [x] Puntuación automática por IA
- [x] Campos condicionales

---

## Variables de Entorno

No se requieren nuevas variables de entorno. Todo usa la configuración de Supabase existente:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

---

## Storage Buckets

Para documentos, usa buckets existentes o crea nuevos:

```typescript
// Bucket para documentos de institución
'institution-documents' (public)

// Bucket para documentos de aplicantes
'application-documents' (private per user_id)

// Bucket para documentos CRM
'crm-attachments' (private per organization)
```

---

## Prueba Rápida

### Ver todo funcionando:

```bash
# 1. Ejecutar migración
supabase migration up

# 2. Ir a dashboard institución
http://localhost:5173/dashboard/institucion

# 3. Expandir tab "Ofertas masivas + IA"
# 4. Crear oferta con requisitos
# 5. Descargar carpeta documental
```

---

## Diferencias: Viejo vs Nuevo

| Característica | BulkOffersModule | EnhancedBulkOffersModule |
|---|---|---|
| Publicar ofertas | ✓ | ✓ |
| Requisitos | ❌ | ✅ Antecedentes, policía, etc. |
| Descarga documental | ❌ | ✅ CSV completo |
| FUID compliance | ❌ | ✅ Automático |
| Matching IA | ✓ | ✓ Mejorado |

| Característica | PatientsModule | EnhancedPatientsModule |
|---|---|---|
| Listar pacientes | ✓ | ✓ |
| Historial servicios | ❌ | ✅ Timeline completo |
| Notas médicas | ✓ | ✓ Mejorado |
| KPIs | ❌ | ✅ Dashboard |
| Coordinadores | ❌ | ✅ Asignación |

---

## Próximos Pasos

1. ✅ Ejecutar migración SQL
2. ✅ Regenerar tipos TypeScript
3. ✅ Actualizar dashboard.institucion.tsx
4. ✅ Crear ruta /institution/profile
5. ✅ Probar en desarrollo
6. ✅ Desplegar a producción

---

## Soporte y Recursos

- **Guía completa:** `IMPLEMENTATION_GUIDE.md`
- **Tipos de datos:** `src/integrations/supabase/types.ts`
- **Rutas:** `src/routes/`
- **Componentes:** `src/components/humanix/`
- **Migraciones:** `supabase/migrations/20260525_expand_institutions.sql`

¡Listo para sincronización en tiempo real! 🚀
