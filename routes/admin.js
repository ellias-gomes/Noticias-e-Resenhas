// Módulos
const express = require('express')
const router = express.Router()

const { Admin } = require('../helper/admin')
const { upload, uploadImage, deleteImage } = require('../config/storage')
const { Categoria, Postagem, User, Comentario } = require('../models')

// Painel Principal Admin (Dashboard com estatísticas em tempo real)
router.get('/', Admin, async (req, res) => {
    try {
        const [postagens, categorias, users, totalComentarios] = await Promise.all([
            Postagem.find().populate('categoria').sort({ date: 'desc' }).lean(),
            Categoria.find().sort({ date: 'desc' }).lean(),
            User.find().sort({ data: 'desc' }).lean(),
            Comentario.countDocuments()
        ])

        const allPosts = postagens || []
        const totalViews = allPosts.reduce((acc, p) => acc + Number(p.views || 0), 0)
        const totalLikes = allPosts.reduce((acc, p) => acc + Number(p.likes || 0), 0)

        res.render('admin/index', {
            stats: {
                postagens: allPosts.length,
                categorias: (categorias || []).length,
                usuarios: (users || []).length,
                comentarios: totalComentarios || 0,
                views: totalViews,
                likes: totalLikes
            },
            recentPosts: allPosts.slice(0, 6)
        })
    } catch (err) {
        console.error(err)
        res.render('admin/index', {
            stats: { postagens: 0, categorias: 0, usuarios: 0, comentarios: 0, views: 0, likes: 0 },
            recentPosts: []
        })
    }
})

// Categorias
router.get('/categorias', Admin, (req, res) => {
    Categoria.find()
        .sort({ date: 'desc' })
        .lean()
        .then((categorias) => {
            res.render('admin/categoria/categorias', { categorias: categorias })
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao listar as categorias.')
            res.redirect('/admin')
        })
})

router.post('/categorias/deletar/', Admin, (req, res) => {
    Categoria.findByIdAndDelete(req.body.id)
        .then(() => {
            req.flash('success_msg', 'Categoria deletada com sucesso!')
            res.redirect('/admin/categorias')
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao deletar a categoria!')
            res.redirect('/admin/categorias')
        })
})

router.get('/categorias/add', Admin, (req, res) => {
    res.render('admin/categoria/addcategorias')
})

router.post('/categorias/nova', Admin, (req, res) => {
    const erros = []
    const nome = (req.body.nome || '').trim()
    const slug = (req.body.slug || '').trim().toLowerCase().replace(/\s+/g, '-')

    if (!nome) {
        erros.push({ texto: 'Nome inválido!' })
    } else if (nome.length < 2) {
        erros.push({ texto: 'Nome muito pequeno!' })
    }

    if (!slug) {
        erros.push({ texto: 'Slug inválido!' })
    }

    if (erros.length > 0) {
        res.render('admin/categoria/addcategorias', { erros: erros })
    } else {
        const novaCategoria = {
            nome: nome,
            slug: slug
        }

        new Categoria(novaCategoria)
            .save()
            .then(() => {
                req.flash('success_msg', 'Categoria criada com sucesso!')
                res.redirect('/admin/categorias')
            })
            .catch((err) => {
                console.error(err)
                req.flash('error_msg', 'Houve um erro ao salvar categoria, tente novamente!')
                res.redirect('/admin/categorias')
            })
    }
})

router.get('/categorias/edit/:id', Admin, (req, res) => {
    Categoria.findById(req.params.id)
        .lean()
        .then((categoria) => {
            if (!categoria) {
                req.flash('error_msg', 'Essa categoria não existe.')
                return res.redirect('/admin/categorias')
            }
            res.render('admin/categoria/editcategorias', { categoria: categoria })
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Essa categoria não existe.')
            res.redirect('/admin/categorias')
        })
})

router.post('/categorias/edit', Admin, (req, res) => {
    const erros = []
    const nome = (req.body.nome || '').trim()
    const slug = (req.body.slug || '').trim().toLowerCase().replace(/\s+/g, '-')

    if (!nome) {
        erros.push({ texto: 'Nome inválido!' })
    } else if (nome.length <= 2) {
        erros.push({ texto: 'Nome muito pequeno!' })
    }

    if (!slug) {
        erros.push({ texto: 'Slug inválido!' })
    }

    if (erros.length > 0) {
        res.render('admin/categoria/editcategorias', {
            erros: erros,
            categoria: { _id: req.body.id, nome: nome, slug: slug }
        })
    } else {
        Categoria.findById(req.body.id)
            .then((categoria) => {
                if (!categoria) {
                    req.flash('error_msg', 'Categoria não encontrada!')
                    return res.redirect('/admin/categorias')
                }
                categoria.nome = nome
                categoria.slug = slug

                return categoria.save().then(() => {
                    req.flash('success_msg', 'Categoria editada com sucesso!')
                    res.redirect('/admin/categorias')
                })
            })
            .catch((err) => {
                console.error(err)
                req.flash('error_msg', 'Houve um erro ao editar a categoria!')
                res.redirect('/admin/categorias')
            })
    }
})

// Postagens
router.get('/postagens', Admin, (req, res) => {
    Postagem.find()
        .populate('categoria')
        .sort({ date: 'desc' })
        .lean()
        .then((postagens) => {
            res.render('admin/postagem/postagens', { postagens: postagens })
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao listar as postagens')
            res.redirect('/admin')
        })
})

router.get('/postagens/add', Admin, (req, res) => {
    Categoria.find()
        .lean()
        .then((categorias) => {
            res.render('admin/postagem/addpostagens', { categorias: categorias })
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao carregar o formulário')
            res.redirect('/admin/postagens')
        })
})

router.post('/postagens/nova', Admin, (req, res) => {
    upload.single('file')(req, res, async (uploadErr) => {
        if (uploadErr) {
            req.flash('error_msg', uploadErr.message || 'Erro no envio da imagem.')
            return res.redirect('/admin/postagens/add')
        }

        const erros = []
        const titulo = (req.body.titulo || '').trim()
        const slug = (req.body.slug || '').trim().toLowerCase().replace(/\s+/g, '-')
        const descricao = (req.body.descricao || '').trim()
        const conteudo = (req.body.conteudo || '').trim()
        const fonte = (req.body.fonte || '').trim()
        const autor = (req.body.autor || (req.user && req.user.nome) || 'Redação').trim()
        const categoria = req.body.categoria
        const carousel = req.body.carousel === 'true'

        if (!titulo) erros.push({ texto: 'Título inválido!' })
        if (!slug) erros.push({ texto: 'Slug inválido!' })
        if (!descricao) erros.push({ texto: 'Descrição inválida!' })
        if (!conteudo) erros.push({ texto: 'Conteúdo inválido!' })
        if (!fonte) erros.push({ texto: 'Fonte inválida!' })
        if (!categoria || categoria === '0') {
            erros.push({ texto: 'Categoria inválida, registre uma categoria!' })
        }
        if (!req.file) {
            erros.push({ texto: 'Selecione uma imagem de capa para a postagem!' })
        }

        if (erros.length > 0) {
            const categorias = await Categoria.find().lean().catch(() => [])
            return res.render('admin/postagem/addpostagens', { erros: erros, categorias: categorias })
        }

        try {
            const imageUrl = await uploadImage(req.file, slug)

            const novaPostagem = {
                titulo: titulo,
                slug: slug,
                descricao: descricao,
                conteudo: conteudo,
                fonte: fonte,
                autor: autor,
                categoria: categoria,
                carousel: carousel,
                img: imageUrl
            }

            await new Postagem(novaPostagem).save()
            req.flash('success_msg', 'Postagem publicada com sucesso!')
            res.redirect('/admin/postagens')
        } catch (err) {
            console.error('Erro durante o salvamento da postagem:', err)
            req.flash('error_msg', 'Houve um erro durante o salvamento da postagem!')
            res.redirect('/admin/postagens')
        }
    })
})

router.get('/postagens/edit/:id', Admin, (req, res) => {
    Postagem.findById(req.params.id)
        .lean()
        .then((postagem) => {
            if (!postagem) {
                req.flash('error_msg', 'Postagem não encontrada!')
                return res.redirect('/admin/postagens')
            }
            Categoria.find()
                .lean()
                .then((categorias) => {
                    res.render('admin/postagem/editpostagens', {
                        categorias: categorias,
                        postagem: postagem
                    })
                })
                .catch((err) => {
                    console.error(err)
                    req.flash('error_msg', 'Houve um erro ao listar as categorias!')
                    res.redirect('/admin/postagens')
                })
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao carregar o formulário de edição!')
            res.redirect('/admin/postagens')
        })
})

router.post('/postagens/edit', Admin, (req, res) => {
    upload.single('file')(req, res, async (uploadErr) => {
        if (uploadErr) {
            req.flash('error_msg', uploadErr.message || 'Erro no envio da imagem.')
            return res.redirect('/admin/postagens')
        }

        try {
            const postagem = await Postagem.findById(req.body.id)
            if (!postagem) {
                req.flash('error_msg', 'Postagem não encontrada!')
                return res.redirect('/admin/postagens')
            }

            const novoSlug = (req.body.slug || postagem.slug).trim().toLowerCase().replace(/\s+/g, '-')

            postagem.titulo = (req.body.titulo || postagem.titulo).trim()
            postagem.slug = novoSlug
            postagem.descricao = (req.body.descricao || postagem.descricao).trim()
            postagem.conteudo = (req.body.conteudo || postagem.conteudo).trim()
            postagem.fonte = (req.body.fonte || postagem.fonte).trim()
            postagem.autor = (req.body.autor || postagem.autor || 'Redação').trim()
            postagem.categoria = req.body.categoria || postagem.categoria
            postagem.carousel = req.body.carousel === 'true'

            if (req.file) {
                const imageUrl = await uploadImage(req.file, novoSlug)
                postagem.img = imageUrl
            }

            await postagem.save()
            req.flash('success_msg', 'Postagem editada com sucesso!')
            res.redirect('/admin/postagens')
        } catch (err) {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao salvar a edição da postagem!')
            res.redirect('/admin/postagens')
        }
    })
})

router.post('/postagens/deletar/', Admin, async (req, res) => {
    try {
        const postagem = await Postagem.findByIdAndDelete(req.body.id)
        if (postagem) {
            await deleteImage(postagem.slug)
            await Comentario.deleteMany({ postagem: String(postagem._id) })
        }
        req.flash('success_msg', 'Postagem deletada com sucesso!')
        res.redirect('/admin/postagens')
    } catch (err) {
        console.error(err)
        req.flash('error_msg', 'Houve um erro ao deletar a postagem!')
        res.redirect('/admin/postagens')
    }
})

module.exports = router
