import * as React from 'react'
import { Text } from '@react-email/components'

interface TokenCodeProps {
  token: string
}

// Bloque con el código de 6 dígitos ({{ .Token }}), visible en grande.
export const TokenCode = ({ token }: TokenCodeProps) => (
  <Text style={codeStyle}>{token}</Text>
)

export const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '32px',
  fontWeight: 'bold' as const,
  letterSpacing: '8px',
  textAlign: 'center' as const,
  color: '#0F766E',
  backgroundColor: '#F0FDFA',
  border: '1px solid #99F6E4',
  borderRadius: '8px',
  padding: '16px 0',
  margin: '0 0 25px',
}

export default TokenCode
