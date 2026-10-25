// Carregando variáveis de ambiente (.env)
require('dotenv').config()

// Carregando módulos
const express = require('express')
const handlebars = require('express-handlebars')
const bodyParser = require('body-parser')
const app = express()
const path = require('path')
const session = require('express-session')
const flash = require('connect-flash')
const passport = require('passport')
const Handlebars = require('handlebars')

const { initDatabase } = require('./config/db')
const { upload, uploadImage, resolveImageUrl } = require('./config/storage')
const { Register } = require('./helper/register')
const { Categoria, Postagem, User, Comentario } = require('./models')

require('./config/auth')(passport)

const admin = require('./routes/admin')
const users = require('./routes/users')

// Configurações de Segurança e Servidor
app.disable('x-powered-by')

// Body Parser
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }))
app.use(bodyParser.json({ limit: '10mb' }))

// Helpers do Handlebars
Handlebars.registerHelper('gt', function (a, b, options) {
    return a > b ? options.fn(this) : options.inverse(this)
})

Handlebars.registerHelper('eq', function (a, b) {
    return String(a) === String(b)
})

Handlebars.registerHelper('formatDate', function (date) {
    if (!date) return ''
    const d = new Date(date)
    if (isNaN(d.getTime())) return String(date)
    return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })
})

Handlebars.registerHelper('imageUrl', function (identifier, type) {
    const resolvedType = typeof type === 'string' ? type : 'post'
    return resolveImageUrl(identifier, resolvedType)
})

// Configuração do Template Engine (Handlebars)
app.engine(
    'handlebars',
    handlebars({
        defaultLayout: 'main',
        runtimeOptions: {
            allowProtoPropertiesByDefault: true,
            allowProtoMethodsByDefault: true
        }
    })
)
app.set('view engine', 'handlebars')
app.set('views', path.join(__dirname, 'views'))

// Arquivos Estáticos (public e tinymce local gratuito)
app.use(express.static(path.join(__dirname, 'public')))
app.use('/tinymce', express.static(path.join(__dirname, 'node_modules', 'tinymce')))

// Sessão com configurações de segurança
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'noticias_chave_secreta_padrao',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 1000 * 60 * 60 * 24 // 1 dia
        }
    })
)

app.use(passport.initialize())
app.use(passport.session())
app.use(flash())

// Middleware Global
app.use(async (req, res, next) => {
    res.locals.success_msg = req.flash('success_msg')
    res.locals.error_msg = req.flash('error_msg')
    res.locals.error = req.flash('error')
    res.locals.user = req.user || null
    res.locals.userId = req.isAuthenticated() && req.user ? req.user._id : null

    try {
        const [categorias, postagens] = await Promise.all([
            Categoria.find().sort({ date: 'desc' }).lean(),
            Postagem.find().populate('categoria').sort({ date: 'desc' }).lean()
        ])
        res.locals.categorias = categorias || []
        res.locals.postagens = postagens || []
        res.locals.carouselPosts = (postagens || []).filter((p) => p.carousel === true)
        next()
    } catch (err) {
        console.error('Erro ao carregar dados globais:', err.message)
        res.locals.categorias = []
        res.locals.postagens = []
        res.locals.carouselPosts = []
        next()
    }
})

// Rotas Principais
app.get('/', (req, res) => {
    res.render('index', { carousel: true })
})

app.get('/404', (req, res) => {
    res.status(404).render('error/404')
})

app.get('/categoria/:slug', (req, res) => {
    Categoria.findOne({ slug: req.params.slug })
        .lean()
        .then((categoria) => {
            if (categoria) {
                Postagem.find({ categoria: categoria._id })
                    .populate('categoria')
                    .sort({ date: 'desc' })
                    .lean()
                    .then((postagens) => {
                        res.render('categoria', { postagens: postagens, categoria: categoria })
                    })
                    .catch((err) => {
                        console.error(err)
                        req.flash('error_msg', 'Houve um erro ao listar os posts!')
                        res.redirect('/')
                    })
            } else {
                req.flash('error_msg', 'Esta categoria não existe!')
                res.redirect('/')
            }
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro interno ao carregar a página desta categoria.')
            res.redirect('/')
        })
})

// Busca segura (com escape contra ReDoS / Regex Injection)
function escapeRegex(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

app.get('/search', (req, res) => {
    const rawSearch = (req.query.pesquisa || '').trim()
    if (!rawSearch) {
        return res.render('busca', { results: [], searchTerm: '' })
    }

    const safeRegex = new RegExp(escapeRegex(rawSearch), 'i')

    Postagem.find({
        $or: [{ titulo: { $regex: safeRegex } }, { descricao: { $regex: safeRegex } }]
    })
        .populate('categoria')
        .sort({ date: 'desc' })
        .lean()
        .then((results) => {
            res.render('busca', { results, searchTerm: rawSearch })
        })
        .catch((err) => {
            console.error(err)
            res.redirect('/404')
        })
})

// Upload de Foto de Perfil (Armazenamento Local ou S3)
app.post('/uploadperfil', Register, (req, res) => {
    upload.single('file')(req, res, async (uploadErr) => {
        if (uploadErr) {
            req.flash('error_msg', uploadErr.message || 'Erro no envio da imagem.')
            return res.redirect(`/users/usuario/${req.user._id}`)
        }

        const file = req.file
        const userId = String(req.user._id)

        if (!file) {
            req.flash('error_msg', 'Nenhum arquivo enviado!')
            return res.redirect(`/users/usuario/${userId}`)
        }

        try {
            const imageUrl = await uploadImage(file, userId)
            await User.findByIdAndUpdate(userId, { avatar: imageUrl })
            req.flash('success_msg', 'Foto de perfil atualizada com sucesso!')
            res.redirect(`/users/usuario/${userId}`)
        } catch (err) {
            console.error('Erro ao fazer o upload da foto de perfil:', err)
            req.flash('error_msg', 'Erro ao atualizar a foto de perfil.')
            res.redirect(`/users/usuario/${userId}`)
        }
    })
})

// Visualização de Postagem
app.get('/post/:slug', (req, res) => {
    Postagem.findOne({ slug: req.params.slug })
        .populate('categoria')
        .lean()
        .then((postagem) => {
            if (postagem) {
                Comentario.find({ postagem: String(postagem._id) })
                    .sort({ _id: 'desc' })
                    .lean()
                    .then((comentario) => {
                        res.render('postagem', { postagem: postagem, comentario: comentario })
                    })
                    .catch((err) => {
                        console.error(err)
                        res.redirect('/')
                    })
            } else {
                req.flash('error_msg', 'Esta postagem não existe!')
                res.redirect('/')
            }
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro interno ao carregar a página desta postagem.')
            res.redirect('/')
        })
})

// Adicionar Comentário
app.post('/posts/:slug/addcomentario', Register, (req, res) => {
    const slug = req.params.slug
    const textoComentario = (req.body.comentario || '').trim()

    if (!textoComentario) {
        req.flash('error_msg', 'O comentário não pode estar vazio!')
        return res.redirect(`/post/${slug}`)
    }

    const novoComentario = {
        usuario: req.user.nome,
        userId: String(req.user._id),
        postagem: req.body.postagem,
        comentario: textoComentario
    }

    new Comentario(novoComentario)
        .save()
        .then(() => {
            req.flash('success_msg', 'Comentário postado com sucesso!')
            res.redirect(`/post/${slug}`)
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao postar comentário, tente novamente!')
            res.redirect(`/post/${slug}`)
        })
})

app.use('/admin', admin)
app.use('/users', users)

// Rota 404 para páginas não encontradas
app.use((req, res) => {
    res.status(404).render('error/404')
})

// Inicialização do Servidor com conexão de banco de dados
const PORT = process.env.PORT || 8081

async function startServer() {
    await initDatabase()
    return app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`)
    })
}

if (require.main === module) {
    startServer()
}

module.exports = app
module.exports.startServer = startServer
