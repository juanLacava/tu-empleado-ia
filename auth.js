import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))

export function setupAuth(app, supabase) {

  app.post("/api/auth/registro", async (req, res) => {
    try {
      const { email, password, nombre_negocio, tipo_negocio } = req.body
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email, password
      })
      if (authError) return res.status(400).json({ error: authError.message })
      if (!authData.user) return res.status(400).json({ error: "No se pudo crear el usuario" })
      const { data: negocio, error: negError } = await supabase
        .from("negocios")
        .insert([{ nombre: nombre_negocio, tipo_negocio, email, user_id: authData.user.id }])
        .select().single()
      if (negError) return res.status(400).json({ error: negError.message })
      res.json({ ok: true, user: authData.user, negocio })
    } catch (err) { res.status(500).json({ error: err.message }) }
  })

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return res.status(401).json({ error: error.message })
      const { data: negocio } = await supabase
        .from("negocios").select("*").eq("user_id", data.user.id).single()
      res.json({ ok: true, token: data.session.access_token, user: data.user, negocio })
    } catch (err) { res.status(500).json({ error: err.message }) }
  })

  app.get("/api/auth/me", async (req, res) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "")
      if (!token) return res.status(401).json({ error: "Sin token" })
      const { data, error } = await supabase.auth.getUser(token)
      if (error) return res.status(401).json({ error: "Token invalido" })
      const { data: negocio } = await supabase
        .from("negocios").select("*").eq("user_id", data.user.id).single()
      res.json({ ok: true, user: data.user, negocio })
    } catch (err) { res.status(500).json({ error: err.message }) }
  })

  app.get("/login", (req, res) => {
    try {
      res.send(readFileSync(join(__dirname, "login.html"), "utf8"))
    } catch (err) { res.status(404).send("login.html no encontrado") }
  })

}
