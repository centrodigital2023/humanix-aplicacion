// De quién son los datos y qué puede hacer quien los mira. El dueño de la cuenta ve todo; una persona del equipo ve solo los módulos que le
// dieron (la base de datos lo vuelve a comprobar en cada lectura y cada acción: esto solo evita mostrar botones que serían rechazados).
export interface CareScope {
  /** La institución dueña de los datos (para el equipo, la institución a la que pertenece). */
  institutionId: string;
  /** Quien está mirando (el dueño o una persona del equipo). */
  viewerId: string;
  viewerName?: string | null;
  institutionName: string;
  isOwner: boolean;
  canPatients: boolean;
  canMonitoring: boolean;
}

export function ownerScope(args: {
  userId: string;
  userName?: string | null;
  institutionName: string;
}): CareScope {
  return {
    institutionId: args.userId,
    viewerId: args.userId,
    viewerName: args.userName ?? null,
    institutionName: args.institutionName,
    isOwner: true,
    canPatients: true,
    canMonitoring: true,
  };
}
