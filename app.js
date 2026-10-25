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
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })
})

Handlebars.registerHelper('readingTime', function (htmlContent) {
    if (!htmlContent) return '1 min de leitura'
    const text = String(htmlContent).replace(/<[^>]*>/g, ' ')
    const words = text.trim().split(/\s+/).filter(Boolean).length
    const minutes = Math.max(1, Math.ceil(words / 180))
    return `${minutes} min de leitura`
})

Handlebars.registerHelper('rankNumber', function (index) {
    const num = Number(index) + 1
    return num < 10 ? `0${num}` : String(num)
})

Handlebars.registerHelper('imageUrl', function (identifier, type) {
    const resolvedType = typeof type === 'string' ? type : 'post'
    return resolveImageUrl(identifier, resolvedType)
})

Handlebars.registerHelper('encodeURI', function (str) {
    return encodeURIComponent(String(str || ''))
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
    res.locals.userId = req.isAuthenticated() && req.user ? String(req.user._id) : null
    res.locals.isAdmin = Boolean(req.isAuthenticated() && req.user && (req.user.Admin === true || req.user.Admin == 1))

    try {
        const [categorias, postagens] = await Promise.all([
            Categoria.find().sort({ date: 'desc' }).lean(),
            Postagem.find().populate('categoria').sort({ date: 'desc' }).lean()
        ])
        const allPosts = postagens || []
        res.locals.categorias = categorias || []
        res.locals.postagens = allPosts
        res.locals.carouselPosts = allPosts.filter((p) => p.carousel === true)
        res.locals.trendingPosts = [...allPosts]
            .sort((a, b) => (b.views || 0) + (b.likes || 0) * 3 - ((a.views || 0) + (a.likes || 0) * 3))
            .slice(0, 5)
        next()
    } catch (err) {
        console.error('Erro ao carregar dados globais:', err.message)
        res.locals.categorias = []
        res.locals.postagens = []
        res.locals.carouselPosts = []
        res.locals.trendingPosts = []
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

// Visualização de Postagem (com incremento de Views, status de Curtida e Compartilhamento)
app.get('/post/:slug', async (req, res) => {
    try {
        const postDoc = await Postagem.findOne({ slug: req.params.slug })
        if (!postDoc) {
            req.flash('error_msg', 'Esta postagem não existe!')
            return res.redirect('/')
        }

        // Incrementa visualizações
        postDoc.views = Number(postDoc.views || 0) + 1
        await postDoc.save()

        const postagem = await Postagem.findOne({ slug: req.params.slug }).populate('categoria').lean()
        const comentario = await Comentario.find({ postagem: String(postagem._id) }).sort({ _id: 'desc' }).lean()

        // Marca quais comentários pertencem ao usuário logado ou se é Admin
        const currentUserId = req.isAuthenticated() && req.user ? String(req.user._id) : null
        const isAdmin = Boolean(req.isAuthenticated() && req.user && (req.user.Admin === true || req.user.Admin == 1))
        const comentariosEnriquecidos = (comentario || []).map((c) => ({
            ...c,
            canDelete: Boolean(isAdmin || (currentUserId && String(c.userId) === currentUserId))
        }))

        const likedBy = Array.isArray(postagem.likedBy) ? postagem.likedBy.map(String) : []
        const userLiked = Boolean(currentUserId && likedBy.includes(currentUserId))

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`
        const shareUrl = `${baseUrl}/post/${postagem.slug}`

        // Filtra recomendações excluindo a própria postagem
        const recomendadas = (res.locals.postagens || [])
            .filter((p) => String(p._id) !== String(postagem._id))
            .slice(0, 4)

        res.render('postagem', {
            postagem: postagem,
            comentario: comentariosEnriquecidos,
            userLiked: userLiked,
            shareUrl: shareUrl,
            recomendadas: recomendadas
        })
    } catch (err) {
        console.error(err)
        req.flash('error_msg', 'Houve um erro interno ao carregar a página desta postagem.')
        res.redirect('/')
    }
})

// Curtir / Descurtir Postagem (Suporta AJAX JSON e Form tradicional)
app.post('/post/:slug/like', async (req, res) => {
    const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))

    if (!req.isAuthenticated() || !req.user) {
        if (wantsJson) {
            return res.status(401).json({
                error: 'Você precisa entrar na sua conta para curtir uma publicação!',
                loginUrl: '/users/login'
            })
        }
        req.flash('error_msg', 'Faça login para curtir esta publicação!')
        return res.redirect('/users/login')
    }

    try {
        const postagem = await Postagem.findOne({ slug: req.params.slug })
        if (!postagem) {
            if (wantsJson) return res.status(404).json({ error: 'Postagem não encontrada' })
            req.flash('error_msg', 'Postagem não encontrada!')
            return res.redirect('/')
        }

        const userId = String(req.user._id)
        const likedBy = Array.isArray(postagem.likedBy) ? postagem.likedBy.map(String) : []
        const index = likedBy.indexOf(userId)
        let liked = false

        if (index === -1) {
            likedBy.push(userId)
            liked = true
        } else {
            likedBy.splice(index, 1)
            liked = false
        }

        postagem.likedBy = likedBy
        postagem.likes = likedBy.length
        await postagem.save()

        if (wantsJson) {
            return res.json({ liked: liked, likes: postagem.likes })
        }

        res.redirect(`/post/${req.params.slug}`)
    } catch (err) {
        console.error('Erro ao curtir postagem:', err)
        if (wantsJson) return res.status(500).json({ error: 'Erro ao processar curtida' })
        res.redirect(`/post/${req.params.slug}`)
    }
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
            req.flash('success_msg', 'Comentário publicado com sucesso!')
            res.redirect(`/post/${slug}#comentarios`)
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao postar comentário, tente novamente!')
            res.redirect(`/post/${slug}`)
        })
})

// Deletar Comentário (Autor do comentário ou Admin)
app.post('/posts/:slug/delcomentario/:id', Register, async (req, res) => {
    const slug = req.params.slug
    try {
        const comentario = await Comentario.findById(req.params.id).lean()
        if (!comentario) {
            req.flash('error_msg', 'Comentário não encontrado.')
            return res.redirect(`/post/${slug}`)
        }

        const isOwner = String(comentario.userId) === String(req.user._id)
        const isAdmin = req.user.Admin === true || req.user.Admin == 1

        if (!isOwner && !isAdmin) {
            req.flash('error_msg', 'Sem permissão para excluir este comentário.')
            return res.redirect(`/post/${slug}`)
        }

        await Comentario.findByIdAndDelete(req.params.id)
        req.flash('success_msg', 'Comentário removido!')
        res.redirect(`/post/${slug}#comentarios`)
    } catch (err) {
        console.error(err)
        req.flash('error_msg', 'Erro ao remover comentário.')
        res.redirect(`/post/${slug}`)
    }
})

app.use('/admin', admin)
app.use('/users', users)

// Rota 404 para páginas não encontradas
app.use((req, res) => {
    res.status(404).render('error/404')
})

// Semente inicial caso o banco esteja vazio (para demonstrar o layout completo já na primeira execução)
async function seedInitialContentIfEmpty() {
    try {
        const totalPosts = await Postagem.countDocuments()
        if (totalPosts === 0) {
            let catTec = await Categoria.findOne({ slug: 'tecnologia' }).lean()
            if (!catTec) {
                catTec = await new Categoria({ nome: 'Tecnologia', slug: 'tecnologia' }).save()
            }
            let catEco = await Categoria.findOne({ slug: 'economia-negocios' }).lean()
            if (!catEco) {
                catEco = await new Categoria({ nome: 'Economia & Negócios', slug: 'economia-negocios' }).save()
            }
            const catCot = await Categoria.findOne({ slug: 'cotidiano' }).lean()
            if (!catCot) {
                await new Categoria({ nome: 'Cotidiano', slug: 'cotidiano' }).save()
            }

            await new Postagem({
                titulo: 'CNH Digital ganha novos recursos de segurança e praticidade no celular',
                slug: 'cnh-digital-novos-recursos-seguranca',
                descricao: 'Aplicativo oficial da Carteira Digital de Trânsito atualiza sistema de validação e facilita o acesso a documentos.',
                conteudo:
                    '<p>A <strong>Carteira Nacional de Habilitação Digital (CNH Digital)</strong> consolidou-se como uma das principais ferramentas de cidadania digital no Brasil. Com a nova atualização, motoristas contam com verificação ainda mais ágil e integração direta com serviços de trânsito.</p><p>Além de dispensar o documento em papel em todo o território nacional, o sistema permite compartilhar o documento do veículo (CRLV) com outros condutores da mesma família de forma segura e criptografada.</p><h3>Principais vantagens da versão atualizada</h3><ul><li>Validação via QR Code mesmo sem conexão com a internet;</li><li>Aviso automático de vencimento do exame toxicológico e da habilitação;</li><li>Assinatura digital e integração com o portal Gov.br.</li></ul>',
                fonte: 'Redação Amarelo News',
                autor: 'Editorial Tech',
                categoria: catTec._id,
                img: '/img/CNH-Digital-533x261.png',
                carousel: true,
                views: 42,
                likes: 8
            }).save()

            await new Postagem({
                titulo: 'Comércio eletrônico e programas de afiliados crescem em ritmo acelerado',
                slug: 'comercio-eletronico-programas-afiliados-crescimento',
                descricao: 'Criadores de conteúdo e microempreendedores impulsionam vendas digitais através de curadoria e recomendações.',
                conteudo:
                    '<p>O mercado de <strong>marketing de afiliados</strong> e vendas por redes sociais tornou-se uma das principais portas de entrada para quem busca empreender na economia digital. Plataformas globais de varejo ampliaram suas ferramentas para pequenos divulgadores.</p><p>Segundo especialistas do setor, a chave para o sucesso está na transparência com o público e na criação de análises reais dos produtos recomendados, gerando confiança e engajamento orgânico nas comunidades online.</p>',
                fonte: 'Caderno de Economia',
                autor: 'Redação Negócios',
                categoria: catEco._id,
                img: '/img/como-ser-um-afiliado-shein.png',
                carousel: true,
                views: 29,
                likes: 5
            }).save()
            console.log('[Seed] Categorias e matérias de demonstração criadas com sucesso!')
        }
    } catch (e) {
        console.error('Aviso no seed inicial:', e.message)
    }
}

// Inicialização do Servidor com conexão de banco de dados
const PORT = process.env.PORT || 8081

async function startServer() {
    await initDatabase()
    await seedInitialContentIfEmpty()
    return app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`)
    })
}

if (require.main === module) {
    startServer()
}

module.exports = app
module.exports.startServer = startServer
