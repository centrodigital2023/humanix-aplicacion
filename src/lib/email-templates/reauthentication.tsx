import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import { TokenCode } from './token-code'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Tu código de verificación de Humanix</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirma tu identidad</Heading>
        <Text style={text}>
          Usa este código de 6 dígitos para confirmar tu identidad (por
          ejemplo, al firmar un contrato):
        </Text>
        <TokenCode token={token} />
        <Text style={footer}>
          Este código vence pronto. Si no lo solicitaste, puedes ignorar este
          correo.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
