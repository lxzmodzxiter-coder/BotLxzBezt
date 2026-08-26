import { describe, expect, it } from "vitest";
import { getAllowedDniFields, getAllowedRucFields } from "./apiperu";
import { inferDocumentType, isValidDni, isValidRuc, parseDocument } from "./domain";

describe("document validation", () => {
  it("only accepts DNI values with eight digits and rejects placeholders", () => {
    expect(isValidDni("44556677")).toBe(true);
    expect(isValidDni("00000000")).toBe(false);
    expect(isValidDni("4455667")).toBe(false);
    expect(parseDocument("dni", " 44556677 ")).toBe("44556677");
  });

  it("validates the RUC check digit before consuming an API query", () => {
    expect(isValidRuc("20131312955")).toBe(true);
    expect(isValidRuc("20131312954")).toBe(false);
    expect(inferDocumentType("20131312955")).toBe("ruc");
    expect(inferDocumentType("44556677")).toBe("dni");
  });
});

describe("APIperú field minimization", () => {
  it("does not expose unapproved personal or address fields", () => {
    const dni = getAllowedDniFields({
      numero: "44556677",
      nombre_completo: "PEREZ GARCIA JUAN CARLOS",
      direccion: "No debe salir",
      fecha_nacimiento: "No debe salir",
    });
    const ruc = getAllowedRucFields({
      ruc: "20131312955",
      nombre_o_razon_social: "EMPRESA DE PRUEBA SAC",
      direccion: "No debe salir",
      departamento: "LIMA",
    });

    expect(dni).toEqual({
      numero: "44556677",
      nombreCompleto: "PEREZ GARCIA JUAN CARLOS",
      nombres: undefined,
      apellidoPaterno: undefined,
      apellidoMaterno: undefined,
      codigoVerificacion: undefined,
    });
    expect(ruc).toEqual({
      ruc: "20131312955",
      razonSocial: "EMPRESA DE PRUEBA SAC",
      estado: undefined,
      condicion: undefined,
      departamento: "LIMA",
      esAgenteRetencion: undefined,
      esBuenContribuyente: undefined,
    });
  });
});
