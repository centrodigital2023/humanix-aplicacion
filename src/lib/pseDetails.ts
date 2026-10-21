import { z } from "zod";

const required = (max: number) => z.string().trim().min(1, "Completa este dato").max(max, `Máximo ${max} caracteres`);

export const pseDetailsSchema = z.object({
  firstName: required(32),
  lastName: required(32),
  streetName: required(18),
  streetNumber: required(5),
  neighborhood: required(18),
  city: required(18),
  zipCode: z.string().trim().regex(/^\d{5,6}$/, "Ingresa un código postal válido"),
  phone: z.string().trim().regex(/^\d{10}$/, "Ingresa los 10 dígitos de tu celular"),
});

export type PseDetails = z.infer<typeof pseDetailsSchema>;

/** Complementa los datos que el Brick de PSE no recoge; no modifica banco, documento ni precio. */
export function withPseDetails(form: Record<string, unknown>, details: PseDetails) {
  const data = pseDetailsSchema.parse(details);
  const payer = form.payer && typeof form.payer === "object" ? form.payer : {};
  return {
    ...form,
    payer: {
      ...payer,
      first_name: data.firstName,
      last_name: data.lastName,
      address: {
        street_name: data.streetName,
        street_number: data.streetNumber,
        neighborhood: data.neighborhood,
        city: data.city,
        zip_code: data.zipCode,
      },
      phone: { area_code: "57", number: data.phone },
    },
  };
}