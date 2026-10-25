require('dotenv').config()
process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1'
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const AWS = require('aws-sdk')

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads')
const TMP_DIR = path.join(UPLOADS_DIR, 'tmp')

// Garante que os diretórios de upload existam
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true })
}

// Tipos de imagem permitidos (Segurança contra upload de arquivos maliciosos)
const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
]

// Configuração do Multer com pasta temporária segura e filtro de arquivos
const storageConfig = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, TMP_DIR)
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
        const ext = path.extname(file.originalname).toLowerCase() || '.png'
        cb(null, `tmp-${uniqueSuffix}${ext}`)
    }
})

const fileFilter = (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true)
    } else {
        cb(new Error('Formato de arquivo inválido! Envie apenas imagens (PNG, JPG, WEBP ou GIF).'), false)
    }
}

const upload = multer({
    storage: storageConfig,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // Limite de 5MB
    }
})

// Sanitiza o nome base do arquivo para evitar Path Traversal
function sanitizeBaseName(name) {
    return String(name || 'imagem')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '-')
}

// Instância S3 (Estrutura secundária pronta para quando STORAGE_TYPE=s3)
function getS3Client() {
    return new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        region: process.env.AWS_REGION || 'sa-east-1'
    })
}

function isS3Enabled() {
    return (
        (process.env.STORAGE_TYPE || 'local').toLowerCase() === 's3' &&
        Boolean(process.env.AWS_ACCESS_KEY_ID) &&
        Boolean(process.env.AWS_SECRET_ACCESS_KEY) &&
        Boolean(process.env.AWS_BUCKET_NAME)
    )
}

/**
 * Remove arquivo temporário de forma segura sem quebrar o fluxo
 */
async function removeTempFile(filePath) {
    if (!filePath) return
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath)
        }
    } catch (err) {
        console.error('Aviso: não foi possível remover arquivo temporário:', err.message)
    }
}

/**
 * Realiza o upload de uma imagem usando o armazenamento Local (padrão gratuito)
 * ou Amazon S3 (estrutura secundária caso STORAGE_TYPE=s3 no .env).
 *
 * @param {Object} file Objeto req.file do Multer
 * @param {String} baseName Nome base do arquivo (ex: slug da postagem ou id do usuário)
 * @returns {Promise<String>} URL pública da imagem salva
 */
async function uploadImage(file, baseName) {
    if (!file || !file.path) {
        throw new Error('Nenhum arquivo enviado.')
    }

    const safeName = sanitizeBaseName(baseName)
    const fileName = `${safeName}.png`

    // Estrutura Secundária: Amazon S3
    if (isS3Enabled()) {
        const s3 = getS3Client()
        const bucketName = process.env.AWS_BUCKET_NAME
        try {
            const fileContent = await fs.promises.readFile(file.path)
            const uploadParams = {
                Bucket: bucketName,
                Key: fileName,
                Body: fileContent,
                ContentType: file.mimetype || 'image/png'
            }
            const data = await s3.upload(uploadParams).promise()
            await removeTempFile(file.path)
            return data.Location || `https://${bucketName}.s3.${process.env.AWS_REGION || 'sa-east-1'}.amazonaws.com/${fileName}`
        } catch (err) {
            await removeTempFile(file.path)
            throw err
        }
    }

    // Sistema Principal (Padrão e Gratuito): Armazenamento Local em /public/uploads
    const targetPath = path.join(UPLOADS_DIR, fileName)
    try {
        await fs.promises.copyFile(file.path, targetPath)
        await removeTempFile(file.path)
        return `/uploads/${fileName}`
    } catch (err) {
        await removeTempFile(file.path)
        throw err
    }
}

/**
 * Exclui uma imagem do armazenamento (Local ou S3)
 * @param {String} baseName Nome base (slug ou userId)
 */
async function deleteImage(baseName) {
    if (!baseName) return
    const safeName = sanitizeBaseName(baseName)
    const fileName = `${safeName}.png`

    if (isS3Enabled()) {
        try {
            const s3 = getS3Client()
            await s3.deleteObject({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: fileName
            }).promise()
        } catch (err) {
            console.error('Aviso ao remover imagem do S3:', err.message)
        }
        return
    }

    const localPath = path.join(UPLOADS_DIR, fileName)
    try {
        if (fs.existsSync(localPath)) {
            await fs.promises.unlink(localPath)
        }
    } catch (err) {
        console.error('Aviso ao remover imagem local:', err.message)
    }
}

/**
 * Resolve a URL de uma imagem para exibição nos templates Handlebars
 * @param {String} identifier Nome base (slug/userId) ou caminho já completo
 * @param {String} type Tipo ('post' ou 'user')
 * @returns {String} URL resolvida
 */
function resolveImageUrl(identifier, type = 'post') {
    const fallback = type === 'user' ? '/img/icon.svg' : '/img/slide.jpg'
    if (!identifier) return fallback

    const str = String(identifier).trim()
    if (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('/')) {
        return str
    }

    const safeName = sanitizeBaseName(str.replace(/\.png$/i, ''))
    const fileName = `${safeName}.png`

    if (isS3Enabled()) {
        const bucket = process.env.AWS_BUCKET_NAME
        const region = process.env.AWS_REGION || 'sa-east-1'
        return `https://${bucket}.s3.${region}.amazonaws.com/${fileName}`
    }

    // Verifica se o arquivo existe localmente em public/uploads
    const localPath = path.join(UPLOADS_DIR, fileName)
    if (fs.existsSync(localPath)) {
        return `/uploads/${fileName}`
    }

    return fallback
}

module.exports = {
    upload,
    uploadImage,
    deleteImage,
    resolveImageUrl,
    isS3Enabled,
    UPLOADS_DIR
}
