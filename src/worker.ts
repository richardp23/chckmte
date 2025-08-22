import { Router } from 'itty-router'

const router = Router()

// Helper function to generate a random string for PKCE
const generateRandomString = (length: number) => {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

// Helper function to create a SHA-256 hash for PKCE
const createSha256Hash = async (str: string) => {
  const textAsBuffer = new TextEncoder().encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return btoa(String.fromCharCode.apply(null, hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Helper function to parse cookies from the request headers
const parseCookies = (request: Request) => {
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) return {}
  return Object.fromEntries(
    cookieHeader.split(';').map((c) => c.trim().split('='))
  )
}

// Helper function to encrypt the refresh token
const encrypt = async (token: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token)
  )
  return `${btoa(String.fromCharCode.apply(null, Array.from(iv)))}.${btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(encrypted))))}`
}

// Helper function to decrypt the refresh token
const decrypt = async (encryptedToken: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )
  const [ivB64, encryptedB64] = encryptedToken.split('.')
  if (!ivB64 || !encryptedB64) {
    throw new Error('Invalid encrypted token format')
  }
  const iv = new Uint8Array(
    atob(ivB64)
      .split('')
      .map((c) => c.charCodeAt(0))
  )
  const encrypted = new Uint8Array(
    atob(encryptedB64)
      .split('')
      .map((c) => c.charCodeAt(0))
  )

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  )
  return new TextDecoder().decode(decrypted)
}

router.get('/auth/login', async (_request, env) => {
  const state = generateRandomString(16)
  const codeVerifier = generateRandomString(128)
  const codeChallenge = await createSha256Hash(codeVerifier)

  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${env.APP_ORIGIN}/auth/callback`,
    scope: 'User.Read Files.ReadWrite offline_access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`

  const headers = new Headers({
    Location: url,
  })

  // Store state and code_verifier in cookies
  headers.append(
    'Set-Cookie',
    `state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`
  )
  headers.append(
    'Set-Cookie',
    `code_verifier=${codeVerifier}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`
  )

  return new Response(null, { status: 302, headers })
})

router.get('/auth/callback', async (request, env) => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const cookies = parseCookies(request)
  const savedState = cookies.state
  const codeVerifier = cookies.code_verifier

  if (!state || state !== savedState) {
    return new Response('Invalid state.', { status: 400 })
  }

  if (!code || !codeVerifier) {
    return new Response('Missing code or verifier.', { status: 400 })
  }

  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    scope: 'User.Read Files.ReadWrite offline_access',
    code,
    redirect_uri: `${env.APP_ORIGIN}/auth/callback`,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
    client_secret: env.MS_CLIENT_SECRET,
  })

  const response = await fetch(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    return new Response(`Token exchange failed: ${error}`, {
      status: response.status,
    })
  }

  const tokenData = await response.json()
  const encryptedRefreshToken = await encrypt(
    tokenData.refresh_token,
    env.ENCRYPTION_KEY
  )

  const headers = new Headers({
    Location: env.APP_ORIGIN,
  })

  // Set the secure refresh token cookie
  headers.append(
    'Set-Cookie',
    `refresh_token=${encryptedRefreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` // 30 days
  )

  // Clear the temporary cookies
  headers.append(
    'Set-Cookie',
    'state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
  )
  headers.append(
    'Set-Cookie',
    'code_verifier=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
  )

  return new Response(null, { status: 302, headers })
})

router.get('/api/me', async (request, env) => {
  const cookies = parseCookies(request)
  const encryptedRefreshToken = cookies.refresh_token

  if (!encryptedRefreshToken) {
    return new Response('Unauthorized.', { status: 401 })
  }

  try {
    const refreshToken = await decrypt(
      encryptedRefreshToken,
      env.ENCRYPTION_KEY
    )

    const params = new URLSearchParams({
      client_id: env.MS_CLIENT_ID,
      scope: 'User.Read Files.ReadWrite offline_access',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_secret: env.MS_CLIENT_SECRET,
    })

    const response = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    )

    if (!response.ok) {
      throw new Error('Failed to refresh token')
    }

    const tokenData = await response.json()
    const { access_token } = tokenData

    const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    })

    if (!userResponse.ok) {
      throw new Error('Failed to fetch user data')
    }

    const userData = await userResponse.json()
    return new Response(JSON.stringify(userData), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    const headers = new Headers()
    headers.append(
      'Set-Cookie',
      'refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    )
    return new Response('An error occurred.', { status: 500, headers })
  }
})

router.get('/auth/logout', () => {
  const headers = new Headers()
  headers.append(
    'Set-Cookie',
    'refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
  )
  return new Response('Logged out.', { headers })
})

router.all('*', () => new Response('Not Found.', { status: 404 }))

export default {
  ...router,
  async fetch(
    request: Request,
    env: Record<string, unknown>,
    ctx: unknown
  ): Promise<Response> {
    const url = new URL(request.url)
    console.log(`[worker] Received request for: ${url.pathname}`)
    // Use router.fetch instead of router.handle
    return router.fetch(request, env, ctx)
  },
}
