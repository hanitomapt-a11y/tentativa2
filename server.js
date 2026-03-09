require("dotenv").config();

const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const pool = require("./db");

const app = express();

app.use(cors({
  origin: ["https://guialar.net", "https://www.guialar.net"],
  methods: ["GET", "POST"]
}));

app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensagem: "API Guia Lar ativa."
  });
});

/* =========================
   ENVIO DE ORÇAMENTO
========================= */
app.post("/enviar-orcamento", async (req, res) => {
  try {
    const { email, largura, altura, area, preco, pdfBase64, nomeFicheiro } = req.body;

    if (!email || !largura || !altura || !pdfBase64) {
      return res.status(400).json({
        mensagem: "Faltam dados obrigatórios."
      });
    }

    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailValido) {
      return res.status(400).json({
        mensagem: "Email inválido."
      });
    }

    const larguraNum = Number(largura);
    const alturaNum = Number(altura);
    const areaNum = Number(area || 0);
    const precoNum = Number(preco || 0);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.verify();

    await transporter.sendMail({
      from: `"Guia Lar" <${process.env.SMTP_FROM}>`,
      to: email,
      subject: "O seu orçamento - Guia Lar",
      text:
        `Olá,\n\n` +
        `Segue em anexo o seu orçamento.\n\n` +
        `Resumo do pedido:\n` +
        `Largura: ${larguraNum.toFixed(2)} m\n` +
        `Altura: ${alturaNum.toFixed(2)} m\n` +
        `Área: ${areaNum.toFixed(2)} m²\n` +
        `Preço estimado: ${precoNum.toFixed(2)} €\n\n` +
        `Obrigado,\nGuia Lar`,
      attachments: [
        {
          filename: nomeFicheiro || "orcamento-guia-lar.pdf",
          content: Buffer.from(pdfBase64, "base64"),
          contentType: "application/pdf"
        }
      ]
    });

    return res.json({
      mensagem: "PDF gerado e enviado com sucesso para o seu email."
    });
  } catch (error) {
    console.error("ERRO COMPLETO AO ENVIAR EMAIL:");
    console.error(error);

    return res.status(500).json({
      mensagem: error.message || "Erro ao enviar o email."
    });
  }
});

/* =========================
   COLEÇÕES
========================= */
app.get("/collections", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        id,
        name,
        slug,
        description,
        image_url,
        sort_order
      FROM collections
      WHERE is_active = 1
      ORDER BY sort_order ASC, id DESC
    `);

    return res.json(rows);
  } catch (error) {
    console.error("Erro ao listar coleções:");
    console.error(error);

    return res.status(500).json({
      mensagem: "Erro ao listar coleções."
    });
  }
});

/* =========================
   PRODUTOS
========================= */
app.get("/products", async (req, res) => {
  try {
    const { collection } = req.query;

    let sql = `
      SELECT
        p.id,
        p.name,
        p.slug,
        p.short_description,
        p.description,
        p.price,
        p.sku,
        p.main_image,
        p.stock_qty,
        p.sort_order,
        c.id AS collection_id,
        c.name AS collection_name,
        c.slug AS collection_slug
      FROM products p
      LEFT JOIN collections c ON c.id = p.collection_id
      WHERE p.is_active = 1
    `;

    const params = [];

    if (collection) {
      sql += ` AND c.slug = ? `;
      params.push(collection);
    }

    sql += ` ORDER BY p.sort_order ASC, p.id DESC `;

    const [products] = await pool.query(sql, params);

    if (!products.length) {
      return res.json([]);
    }

    const productIds = products.map(product => product.id);

    const [images] = await pool.query(`
      SELECT
        id,
        product_id,
        image_url,
        alt_text,
        sort_order
      FROM product_images
      WHERE product_id IN (${productIds.map(() => "?").join(",")})
      ORDER BY sort_order ASC, id ASC
    `, productIds);

    const [colors] = await pool.query(`
      SELECT
        id,
        product_id,
        color_name,
        color_hex,
        image_url,
        sort_order
      FROM product_variant_colors
      WHERE product_id IN (${productIds.map(() => "?").join(",")})
      ORDER BY sort_order ASC, id ASC
    `, productIds);

    const finalProducts = products.map(product => ({
      ...product,
      images: images.filter(img => img.product_id === product.id),
      colors: colors.filter(color => color.product_id === product.id)
    }));

    return res.json(finalProducts);
  } catch (error) {
    console.error("Erro ao listar produtos:");
    console.error(error);

    return res.status(500).json({
      mensagem: "Erro ao listar produtos."
    });
  }
});

/* =========================
   PRODUTO POR SLUG
========================= */
app.get("/products/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const [rows] = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.slug,
        p.short_description,
        p.description,
        p.price,
        p.sku,
        p.main_image,
        p.stock_qty,
        p.sort_order,
        c.id AS collection_id,
        c.name AS collection_name,
        c.slug AS collection_slug
      FROM products p
      LEFT JOIN collections c ON c.id = p.collection_id
      WHERE p.slug = ? AND p.is_active = 1
      LIMIT 1
    `, [slug]);

    if (!rows.length) {
      return res.status(404).json({
        mensagem: "Produto não encontrado."
      });
    }

    const product = rows[0];

    const [images] = await pool.query(`
      SELECT
        id,
        image_url,
        alt_text,
        sort_order
      FROM product_images
      WHERE product_id = ?
      ORDER BY sort_order ASC, id ASC
    `, [product.id]);

    const [colors] = await pool.query(`
      SELECT
        id,
        color_name,
        color_hex,
        image_url,
        sort_order
      FROM product_variant_colors
      WHERE product_id = ?
      ORDER BY sort_order ASC, id ASC
    `, [product.id]);

    return res.json({
      ...product,
      images,
      colors
    });
  } catch (error) {
    console.error("Erro ao obter produto:");
    console.error(error);

    return res.status(500).json({
      mensagem: "Erro ao obter produto."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor ativo na porta ${PORT}`);
});
