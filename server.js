import { setupAuth } from "./auth.js"
import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import OpenAI from "openai"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(cors())
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
})

async function generarRespuesta(mensajeUsuario, contextoNegocio = "", historial = []) {
  const systemPrompt = `Sos un asistente de atencion al cliente inteligente y amigable.
${contextoNegocio ? `Trabajas para: ${contextoNegocio}` : ""}
Responde siempre en español, de forma clara y concisa.
Si no sabes algo, decilo honestamente y ofrece ayuda alternativa.`
  const messages = [
    { role: "system", content: systemPrompt },
    ...historial.slice(-10),
    { role: "user", content: mensajeUsuario },
  ]
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    max_tokens: 500,
    temperature: 0.7,
  })
  return completion.choices[0].message.content
}

app.post("/api/negocio", async (req, res) => {
  try {
    const { nombre, email, tipo_negocio, user_id } = req.body
    const { data, error } = await supabase.from("negocios").insert([{ nombre, email, tipo_negocio, user_id }]).select().single()
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true, negocio: data })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get("/api/negocio/:user_id", async (req, res) => {
  try {
    const { data, error } = await supabase.from("negocios").select("*").eq("user_id", req.params.user_id).single()
    if (error) return res.status(404).json({ error: "Negocio no encontrado" })
    res.json(data)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get("/api/clientes/:negocio_id", async (req, res) => {
  try {
    const { data, error } = await supabase.from("clientes").select("*").eq("negocio_id", req.params.negocio_id).order("creado_en", { ascending: false })
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post("/api/clientes", async (req, res) => {
  try {
    const { negocio_id, nombre, telefono, email, notas } = req.body
    const { data: existente } = await supabase.from("clientes").select("*").eq("negocio_id", negocio_id).eq("telefono", telefono).single()
    if (existente) return res.json({ ok: true, cliente: existente, nuevo: false })
    const { data, error } = await supabase.from("clientes").insert([{ negocio_id, nombre, telefono, email, notas }]).select().single()
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true, cliente: data, nuevo: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put("/api/clientes/:id", async (req, res) => {
  try {
    const { nombre, telefono, email, notas, ultima_compra } = req.body
    const { data, error } = await supabase.from("clientes").update({ nombre, telefono, email, notas, ultima_compra }).eq("id", req.params.id).select().single()
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true, cliente: data })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post("/api/conversaciones", async (req, res) => {
  try {
    const { cliente_id, canal = "web" } = req.body
    const { data: abierta } = await supabase.from("conversaciones").select("*").eq("cliente_id", cliente_id).eq("canal", canal).eq("abierta", true).single()
    if (abierta) return res.json({ ok: true, conversacion: abierta, nueva: false })
    const { data, error } = await supabase.from("conversaciones").insert([{ cliente_id, canal }]).select().single()
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true, conversacion: data, nueva: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put("/api/conversaciones/:id/cerrar", async (req, res) => {
  try {
    const { error } = await supabase.from("conversaciones").update({ abierta: false }).eq("id", req.params.id)
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post("/api/mensaje", async (req, res) => {
  try {
    const { cliente_id, conversacion_id, mensaje, negocio_nombre = "" } = req.body
    const { data: historialDB } = await supabase.from("mensajes").select("mensaje, respuesta, rol").eq("conversacion_id", conversacion_id).order("fecha", { ascending: true }).limit(10)
    const historial = []
    if (historialDB) {
      for (const m of historialDB) {
        historial.push({ role: "user", content: m.mensaje })
        if (m.respuesta) historial.push({ role: "assistant", content: m.respuesta })
      }
    }
    const respuesta = await generarRespuesta(mensaje, negocio_nombre, historial)
    const { data, error } = await supabase.from("mensajes").insert([{ cliente_id, conversacion_id, mensaje, respuesta, rol: "cliente" }]).select().single()
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true, respuesta, mensaje_id: data.id })
  } catch (err) {
    console.error("Error en /api/mensaje:", err)
    res.status(500).json({ error: err.message })
  }
})

app.get("/api/mensajes/:conversacion_id", async (req, res) => {
  try {
    const { data, error } = await supabase.from("mensajes").select("*").eq("conversacion_id", req.params.conversacion_id).order("fecha", { ascending: true })
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get("/api/productos/:negocio_id", async (req, res) => {
  try {
    const { data, error } = await supabase.from("productos").select("*").eq("negocio_id", req.params.negocio_id).order("nombre")
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post("/api/productos", async (req, res) => {
  try {
    const { negocio_id, nombre, precio, stock } = req.body
    const { data, error } = await supabase.from("productos").insert([{ negocio_id, nombre, precio, stock }]).select().single()
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true, producto: data })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post("/api/campanas", async (req, res) => {
  try {
    const { negocio_id, titulo, contenido, canal } = req.body
    const { data, error } = await supabase.from("campanas").insert([{ negocio_id, titulo, contenido, canal }]).select().single()
    if (error) return res.status(400).json({ error: error.message })
    res.json({ ok: true, campana: data })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get("/api/campanas/:negocio_id", async (req, res) => {
  try {
    const { data, error } = await supabase.from("campanas").select("*").eq("negocio_id", req.params.negocio_id).order("creado_en", { ascending: false })
    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get("/test-ia", async (req, res) => {
  try {
    const respuesta = await generarRespuesta("Hola! Que productos tenes disponibles?", "Gimnasio PowerFit")
    res.json({ ok: true, modelo: "llama-3.3-70b-versatile", respuesta })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get("/panel", (req, res) => {
  try {
    res.send(readFileSync(join(__dirname, "panel.html"), "utf8"))
  } catch (err) {
    res.status(404).send("panel.html no encontrado. Copialo a la carpeta del proyecto.")
  }
})

app.get("/", (req, res) => {
  try {
    res.send(readFileSync(join(__dirname, "landing.html"), "utf8"))
  } catch(e) {
    res.json({ ok: true, mensaje: "Servidor Tu Empleado IA corriendo" })
  }
})


setupAuth(app, supabase)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => { console.log(`Servidor corriendo en puerto ${PORT}`) })

// ── AUTH ──
app.post("/api/auth/registro", async (req, res) => {
  try {
    const { email, password, nombre_negocio, tipo_negocio } = req.body
    // Crear usuario en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })
    if (authError) return res.status(400).json({ error: authError.message })
    // Crear negocio vinculado al usuario
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
    // Buscar negocio del usuario
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
    if (error) return res.status(401).json({ error: "Token inválido" })
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
