import { ReactNode } from "react";

export interface ArticleContent {
  title: string;
  excerpt: string;
  publishedDate: string; // YYYY-MM-DD
  readingMinutes: number;
  body: ReactNode;
  related: { label: string; to: string }[];
}

export const ARTICLES: Record<string, ArticleContent> = {
  "cuanto-cuesta-enfermera-domicilio": {
    title: "¿Cuánto cuesta una enfermera a domicilio en Colombia?",
    excerpt:
      "Tarifas reales 2025 por hora, turno y 24/7 para enfermeras y auxiliares en Bogotá, Medellín, Cali y Barranquilla.",
    publishedDate: "2025-04-01",
    readingMinutes: 6,
    body: (
      <>
        <p>
          Una enfermera profesional con tarjeta RETHUS en Colombia cuesta entre <strong>$30.000 y $55.000 por hora</strong> en 2025, dependiendo de la ciudad, la complejidad del paciente y el turno. Una auxiliar de enfermería cuesta entre <strong>$22.000 y $35.000 por hora</strong>, y un cuidador con experiencia entre <strong>$15.000 y $28.000 por hora</strong>.
        </p>
        <h2>Tarifas por modalidad</h2>
        <ul>
          <li><strong>Por hora suelta:</strong> ideal para curaciones puntuales o acompañamiento corto.</li>
          <li><strong>Turno de 8 horas:</strong> 10-15% de descuento sobre el valor hora.</li>
          <li><strong>Turno de 12 horas:</strong> hasta 20% de descuento.</li>
          <li><strong>24/7 o interno:</strong> tarifa mensual desde $2.800.000 para cuidador y desde $4.500.000 para enfermería profesional.</li>
        </ul>
        <h2>¿Por qué varían tanto los precios?</h2>
        <p>
          Los factores principales son: ciudad (Bogotá y Medellín suelen ser más altas), turno nocturno o festivo (recargo del 35-75%), nivel de complejidad clínica (pacientes con traqueostomía, sondas o quimioterapia requieren formación adicional) y experiencia.
        </p>
        <h2>Cómo obtener una cotización</h2>
        <p>
          En <a href="/buscar">Humanix</a> recibes una cotización personalizada en menos de 2 minutos describiendo el caso del paciente. Nuestra IA empareja el perfil con profesionales verificados RETHUS cercanos.
        </p>
      </>
    ),
    related: [
      { label: "Cómo verificar el RETHUS", to: "/recursos/como-verificar-rethus" },
      { label: "Cómo contratar cuidador de confianza", to: "/recursos/contratar-cuidador-confianza" },
      { label: "Enfermería domiciliaria 24/7", to: "/enfermeria-domiciliaria" },
    ],
  },

  "como-verificar-rethus": {
    title: "Cómo verificar el RETHUS de un profesional de la salud",
    excerpt:
      "Paso a paso para confirmar la tarjeta profesional en el Registro Único Nacional del Talento Humano en Salud.",
    publishedDate: "2025-04-05",
    readingMinutes: 4,
    body: (
      <>
        <p>
          El <strong>RETHUS</strong> (Registro Único Nacional del Talento Humano en Salud) es el sistema oficial del Ministerio de Salud de Colombia donde se inscriben todos los profesionales del sector. Verificarlo antes de contratar es la forma más confiable de saber si una enfermera o médico está habilitado para ejercer.
        </p>
        <h2>Paso a paso</h2>
        <ol>
          <li>Ingresa al portal oficial: <code>https://web.sispro.gov.co/THS/Cliente/ConsultasPublicas/ConsultaPublicaRETHUS.aspx</code></li>
          <li>Selecciona el tipo de identificación y digita el número de cédula del profesional.</li>
          <li>Revisa que el resultado muestre profesión, número de identificación única y entidad formadora.</li>
          <li>Compara los datos con la cédula física que te muestre la persona.</li>
        </ol>
        <h2>¿Qué pasa si no aparece?</h2>
        <p>
          Si el profesional no aparece, no debes contratarlo. Puede tratarse de un caso pendiente de inscripción o de alguien que no está habilitado. En Humanix toda enfermería profesional pasa por verificación RETHUS automatizada antes de poder publicar perfil.
        </p>
      </>
    ),
    related: [
      { label: "Cuánto cuesta una enfermera a domicilio", to: "/recursos/cuanto-cuesta-enfermera-domicilio" },
      { label: "Enfermería domiciliaria 24/7", to: "/enfermeria-domiciliaria" },
    ],
  },

  "cuidado-adulto-mayor-guia": {
    title: "Guía completa para cuidar a un adulto mayor en casa",
    excerpt:
      "Higiene, alimentación, prevención de caídas, manejo de medicamentos y señales de alerta que no debes ignorar.",
    publishedDate: "2025-04-08",
    readingMinutes: 8,
    body: (
      <>
        <p>
          Cuidar a un adulto mayor en casa requiere combinar afecto, organización y técnica. Esta guía resume los pilares fundamentales que todo cuidador familiar debería dominar.
        </p>
        <h2>1. Higiene diaria</h2>
        <p>Baño completo cada 2-3 días si no hay incontinencia, higiene íntima diaria, lavado de cabello una o dos veces por semana y revisión cuidadosa de la piel para detectar úlceras tempranas.</p>
        <h2>2. Alimentación</h2>
        <p>Comidas pequeñas y frecuentes (5-6 al día), texturas adecuadas si hay disfagia, y mucha hidratación. Consulta con un nutricionista si hay diabetes, falla renal o hipertensión.</p>
        <h2>3. Prevención de caídas</h2>
        <p>Retira alfombras sueltas, instala barras en el baño, usa calzado antideslizante y mejora la iluminación nocturna del trayecto cuarto-baño.</p>
        <h2>4. Manejo de medicamentos</h2>
        <p>Usa pastilleros semanales, lleva una lista actualizada de medicamentos y dosis, y nunca improvises con medicamentos de venta libre.</p>
        <h2>5. Señales de alarma</h2>
        <p>Confusión súbita, fiebre, dificultad respiratoria, dolor torácico, debilidad de un lado del cuerpo o caída con golpe en la cabeza requieren atención médica inmediata.</p>
      </>
    ),
    related: [
      { label: "Cuidado adulto mayor (servicio)", to: "/cuidado-adulto-mayor" },
      { label: "Signos de alarma en pacientes crónicos", to: "/recursos/signos-alarma-paciente-cronico" },
    ],
  },

  "postoperatorio-en-casa": {
    title: "Postoperatorio en casa: qué necesitas y cómo prepararte",
    excerpt:
      "Lista práctica para una recuperación segura: cuarto, insumos, enfermería, alimentación y signos de complicaciones.",
    publishedDate: "2025-04-10",
    readingMinutes: 7,
    body: (
      <>
        <p>
          Una buena preparación del hogar reduce complicaciones postoperatorias y acelera la recuperación. Aquí los esenciales.
        </p>
        <h2>El cuarto</h2>
        <p>Cama firme, idealmente con baranda, mesa de noche cercana, agua a la mano, control para luces y ventilación. Si la cirugía fue de miembros inferiores, organiza el primer piso.</p>
        <h2>Insumos básicos</h2>
        <ul>
          <li>Gasas estériles, esparadrapo hipoalergénico, solución salina.</li>
          <li>Termómetro, tensiómetro digital y pulsioxímetro.</li>
          <li>Medicamentos formulados con horarios claros.</li>
          <li>Almohadas extra para posicionar la zona operada.</li>
        </ul>
        <h2>Enfermería domiciliaria</h2>
        <p>Para curaciones, manejo de drenajes y administración IV es indispensable contar con <a href="/enfermeria-domiciliaria">enfermería con tarjeta RETHUS</a>.</p>
        <h2>Signos de complicación</h2>
        <p>Fiebre &gt;38°C, sangrado activo, dolor que no cede con analgesia, enrojecimiento o secreción purulenta de la herida, dificultad respiratoria o palpitaciones requieren atención inmediata.</p>
      </>
    ),
    related: [
      { label: "Cuidado postoperatorio (servicio)", to: "/cuidado-postoperatorio" },
      { label: "Enfermería domiciliaria 24/7", to: "/enfermeria-domiciliaria" },
    ],
  },

  "signos-alarma-paciente-cronico": {
    title: "10 signos de alarma en pacientes crónicos en casa",
    excerpt:
      "Cuándo llamar al médico, cuándo acudir a urgencias y cuándo activar la línea 123. Guía rápida para cuidadores.",
    publishedDate: "2025-04-12",
    readingMinutes: 5,
    body: (
      <>
        <p>
          Los pacientes crónicos pueden descompensarse rápido. Estos 10 signos requieren acción inmediata:
        </p>
        <ol>
          <li>Confusión o desorientación nueva.</li>
          <li>Dolor torácico o en la mandíbula.</li>
          <li>Falta de aire en reposo.</li>
          <li>Debilidad súbita en cara, brazo o pierna.</li>
          <li>Pérdida del habla o visión.</li>
          <li>Fiebre &gt;38.5°C que no cede.</li>
          <li>Sangrado activo (digestivo, urinario, herida).</li>
          <li>Crisis convulsiva.</li>
          <li>Glicemia &lt;60 o &gt;400 mg/dL.</li>
          <li>Saturación de oxígeno &lt;90% sin oxígeno.</li>
        </ol>
        <p>
          Ante cualquiera de estos, activa la <strong>línea 123</strong> en Colombia o traslada al servicio de urgencias más cercano.
        </p>
      </>
    ),
    related: [
      { label: "Guía cuidado adulto mayor", to: "/recursos/cuidado-adulto-mayor-guia" },
      { label: "Cuidado paliativo", to: "/cuidado-paliativo" },
    ],
  },

  "contratar-cuidador-confianza": {
    title: "Cómo contratar un cuidador de confianza sin estafas",
    excerpt:
      "Verificación de antecedentes, referencias laborales, contratos y cláusulas que protegen a tu familia.",
    publishedDate: "2025-04-15",
    readingMinutes: 6,
    body: (
      <>
        <p>
          Contratar un cuidador particular sin verificación expone a tu familia a riesgos: hurtos, maltrato, negligencia o suplantación. Estos son los pasos mínimos que recomendamos:
        </p>
        <h2>1. Verifica antecedentes</h2>
        <p>Solicita certificado de antecedentes judiciales (Policía Nacional), antecedentes disciplinarios y, si aplica, RETHUS.</p>
        <h2>2. Pide y llama referencias</h2>
        <p>Mínimo 2 referencias laborales recientes. Llama y pregunta sobre puntualidad, trato al paciente y honestidad.</p>
        <h2>3. Firma un contrato claro</h2>
        <p>Incluye horarios, funciones, tarifa, forma de pago, periodo de prueba y cláusula de confidencialidad.</p>
        <h2>4. Usa una plataforma con respaldo</h2>
        <p>En <a href="/">Humanix</a> hacemos toda la verificación por ti, ofrecemos respaldo de pólizas y un soporte 24/7 para cualquier eventualidad.</p>
      </>
    ),
    related: [
      { label: "Cuidador a domicilio", to: "/cuidador-domicilio" },
      { label: "Cómo verificar el RETHUS", to: "/recursos/como-verificar-rethus" },
    ],
  },
};