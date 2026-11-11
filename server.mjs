import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.static('./'));

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Define la personalidad de Verity
const SYSTEM_INSTRUCTION = `
Eres "Verity", un asistente personal sabio, amigable y conversacional, si te llaman desde otro nombre, puedes recalcar que tu nombre real es Verity. 
Reglas de personalidad:
1. Afirmas saberlo todo, pero siempre de manera humilde y carismática. Tienes acceso a la hora local y ubicación del usuario; úsalo de forma natural y sorprendente en la charla (por ejemplo, comentando la hora o su región sin que te lo tenga que decir directamente), pero hazlo de vez en cuando, no en cada mensaje que mandes.
2. No te limites a responder: haz preguntas al usuario de forma natural para conocerlo mejor y romper el hielo.
3. Si el usuario pregunta algo explícito o restringido por seguridad, en lugar de bloquear la respuesta o ser robótico, responde: "Perdon, pero no puedo ayudarte con ese tipo de informacion, porque es confidencial, que te parece si hablamos de otra cosa?" o algo asi.
4. Mantén tus respuestas directas, naturales y conversacionales.
5. Trata de ser un amigo para el usuario, ademas de que no menciones muchas veces la fecha que es en el dispositivo del usuario, solo la hora
`;

app.post('/api/chat', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string'
      ? req.body.message
      : typeof req.body?.mensaje === 'string'
        ? req.body.mensaje
        : '';
    const history = req.body?.history || [];
    const images = req.body?.images || [];

    if (!Array.isArray(images) || images.length > MAX_IMAGES) {
      return res.status(400).json({ error: `Puedes enviar hasta ${MAX_IMAGES} imágenes por mensaje.` });
    }

    if (!message.trim() && images.length === 0) {
      return res.status(400).json({ error: 'Escribe un mensaje o adjunta una imagen.' });
    }

    if (!genAI) {
      return res.status(503).json({ error: 'El servidor no tiene configurada la clave de Gemini.' });
    }

    // Procesar imágenes de forma limpia
    const imageParts = [];
    if (Array.isArray(images)) {
      for (const image of images) {
        if (image && typeof image.data === 'string' && image.data.trim() !== '') {
          const mimeType = image.mimeType;
          const data = image.data;
          
          if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
            throw new Error('Imagen inválida. Usa archivos JPG, PNG o WEBP.');
          }

          const sizeInBytes = Buffer.byteLength(data, 'base64');
          if (sizeInBytes > MAX_IMAGE_BYTES) {
            throw new Error('Each image must weigh 5 MB or less.');
          }

          imageParts.push({
            inlineData: {
              data: data,
              mimeType: mimeType
            }
          });
        }
      }
    }

    const safeHistory = Array.isArray(history)
      ? history
        .filter(entry => (entry?.role === 'user' || entry?.role === 'model')
          && Array.isArray(entry.parts))
        .slice(-20)
        .map(entry => ({
          role: entry.role,
          parts: entry.parts
            .filter(part => typeof part?.text === 'string')
            .map(part => ({ text: part.text }))
        }))
        .filter(entry => entry.parts.length > 0)
      : [];

    // Inicialización simplificada y compatible del modelo
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash-lite',
      systemInstruction: SYSTEM_INSTRUCTION
    });

    const chat = model.startChat({
      history: safeHistory
    });

    const parts = [];
    if (message.trim()) {
      parts.push({ text: message });
    }
    if (imageParts.length > 0) {
      parts.push(...imageParts);
    }
    if (parts.length === 0) {
      parts.push({ text: 'Analiza la imagen adjunta.' });
    }

    const result = await chat.sendMessage(parts);
    const responseText = result.response.text();

    res.json({ response: responseText });
  } catch (error) {
    console.error('Error detallado en Gemini API:', error);
    if (error instanceof Error
      && (error.message.startsWith('Imagen inválida') || error.message.startsWith('Each image'))) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'No se pudo completar la solicitud a Gemini.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Verity activo en http://localhost:${PORT}`);
});
