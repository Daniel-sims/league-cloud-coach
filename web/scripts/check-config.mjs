const project = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!project || !key || project.includes('your-project')) {
  throw new Error(
    'Set the VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY repository variables before deploying. See web/README.md.',
  )
}
const url = new URL(project)
if (url.protocol !== 'https:') throw new Error('The production Supabase URL must use HTTPS.')
if (key.startsWith('sb_secret_'))
  throw new Error('Never bundle a Supabase secret key. Use the publishable key.')
if (key.split('.').length === 3) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
  if (payload.role !== 'anon')
    throw new Error('Only a legacy anon key may be bundled. Never use service_role.')
} else if (!key.startsWith('sb_publishable_')) {
  throw new Error('Expected a Supabase publishable key or legacy anon key.')
}
console.log('Production cloud configuration is present; no private keys are bundled.')
