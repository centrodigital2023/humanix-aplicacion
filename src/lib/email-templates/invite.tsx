import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import { TokenCode } from "./token-code";

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  confirmationUrl: string;
  token?: string;
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl, token }: InviteEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head>
      <style>{darkModeCss}</style>
    </Head>
    <Preview>Te invitaron a unirte a {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Te invitaron a unirte</Heading>
        <Text style={text}>
          Te invitaron a unirte a{" "}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          .
        </Text>
        {token ? (
          <>
            <Text style={text}>Tu código de verificación de 6 dígitos es:</Text>
            <TokenCode token={token} />
            <Text style={text}>O acepta la invitación y crea tu cuenta con el botón:</Text>
          </>
        ) : (
          <Text style={text}>Acepta la invitación y crea tu cuenta con el botón:</Text>
        )}
        <Button className="dm-btn" style={button} href={confirmationUrl}>
          Aceptar invitación
        </Button>
        <Text style={footer}>Si no esperabas esta invitación, puedes ignorar este correo.</Text>
      </Container>
    </Body>
  </Html>
);

export default InviteEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = {
  fontSize: "22px",
  fontWeight: "bold" as const,
  color: "#000000",
  margin: "0 0 20px",
};
const text = {
  fontSize: "14px",
  color: "#55575d",
  lineHeight: "1.5",
  margin: "0 0 25px",
};
const link = { color: "inherit", textDecoration: "underline" };
const button = {
  backgroundColor: "#0F766E",
  color: "#ffffff",
  fontSize: "14px",
  border: "1px solid #0F766E",
  borderRadius: "8px",
  padding: "12px 20px",
  textDecoration: "none",
};
const footer = { fontSize: "12px", color: "#999999", margin: "30px 0 0" };
// Rendered as a text child, which React may HTML-escape: keep this CSS free of >, &, and quotes.
const darkModeCss = `
  @media (prefers-color-scheme: dark) {
    .dm-btn { background-color: #ffffff !important; color: #000000 !important; }
  }
  [data-ogsc] .dm-btn { background-color: #ffffff !important; color: #000000 !important; }
  [data-ogsb] .dm-btn { background-color: #ffffff !important; color: #000000 !important; }
`;
