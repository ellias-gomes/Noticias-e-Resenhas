const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const passport = require('passport')
const nodemailer = require('nodemailer')
const sendGridTransport = require('nodemailer-sendgrid-transport')
const crypto = require('crypto')

const { Admin } = require('../helper/admin')
const { Register } = require('../helper/register')
const { User, Postagem, Comentario } = require('../models')

// Configuração do transporte de E-mail (Suporta SendGrid, SMTP ou Modo Local de Desenvolvimento)
function createMailTransporter() {
    if (process.env.SENDGRID_API_KEY) {
        return nodemailer.createTransport(
            sendGridTransport({
                auth: {
                    api_key: process.env.SENDGRID_API_KEY
                }
            })
        )
    }

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        })
    }

    return null
}

const transporter = createMailTransporter()
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 8081}`
const EMAIL_FROM = process.env.EMAIL_FROM || 'no-reply@noticias.local'

async function sendEmailSafe(mailOptions) {
    if (!transporter) {
        console.log('------------------------------------------------------------')
        console.log('[MODO DEV - E-mail simulado pois SMTP/SendGrid não está configurado no .env]')
        console.log('Para:', mailOptions.to)
        console.log('Assunto:', mailOptions.subject)
        console.log('Conteúdo HTML:', mailOptions.html)
        console.log('------------------------------------------------------------')
        return false
    }

    try {
        const info = await transporter.sendMail(mailOptions)
        console.log('E-mail enviado com sucesso para:', mailOptions.to, info && info.response)
        return true
    } catch (error) {
        console.error('Erro ao enviar o e-mail:', error.message)
        return false
    }
}

// Excluir usuário não confirmado após o tempo limite (apenas quando o envio de e-mail está ativo)
function agendarExclusaoNaoConfirmado(userId) {
    if (!transporter) return

    setTimeout(() => {
        User.findById(userId)
            .then((user) => {
                if (user && !user.confirm) {
                    console.log('Usuário não confirmado excluído:', user.email)
                    return User.findByIdAndDelete(userId)
                }
                return null
            })
            .catch((error) => {
                console.error('Erro ao excluir usuário não confirmado:', error)
            })
    }, 600000) // 10 minutos
}

// Registro
router.get('/registro', (req, res) => {
    res.render('usuario/registro')
})

router.post('/registro', (req, res) => {
    const erros = []
    const nome = (req.body.nome || '').trim()
    const email = (req.body.email || '').trim().toLowerCase()
    const senha = req.body.senha || ''
    const senha2 = req.body.senha2 || ''

    if (!nome) {
        erros.push({ texto: 'Nome inválido!' })
    }
    if (!email || !email.includes('@')) {
        erros.push({ texto: 'E-mail inválido!' })
    }
    if (!senha) {
        erros.push({ texto: 'Senha inválida!' })
    } else if (senha.length <= 4) {
        erros.push({ texto: 'Senha muito curta (mínimo de 5 caracteres)!' })
    }
    if (senha !== senha2) {
        erros.push({ texto: 'As senhas são diferentes, tente novamente!' })
    }

    if (erros.length > 0) {
        res.render('usuario/registro', { erros: erros })
    } else {
        User.findOne({ email: email })
            .lean()
            .then((user) => {
                if (user) {
                    req.flash('error_msg', 'Já existe uma conta com esse e-mail!')
                    return res.redirect('/users/registro')
                }

                // Se for o primeiro usuário do banco, torna Admin automaticamente para facilitar o acesso inicial
                User.countDocuments().then((totalUsers) => {
                    const isFirstUser = totalUsers === 0
                    const novoUser = new User({
                        nome: nome,
                        email: email,
                        senha: senha,
                        Admin: isFirstUser,
                        confirm: !transporter // Se não houver SMTP configurado, já confirma automaticamente
                    })

                    bcrypt.genSalt(10, (erroSalt, salt) => {
                        if (erroSalt) {
                            req.flash('error_msg', 'Houve um erro durante o salvamento do usuário!')
                            return res.redirect('/users/registro')
                        }
                        bcrypt.hash(novoUser.senha, salt, (erroHash, hash) => {
                            if (erroHash) {
                                req.flash('error_msg', 'Houve um erro durante o salvamento do usuário!')
                                return res.redirect('/users/registro')
                            }
                            novoUser.senha = hash
                            novoUser
                                .save()
                                .then(async (usuarioSalvo) => {
                                    agendarExclusaoNaoConfirmado(usuarioSalvo._id)

                                    const idUsuario = usuarioSalvo._id
                                    const nomeUsuario = usuarioSalvo.nome
                                    const linkConfirmacao = `${BASE_URL}/users/confirm/${idUsuario}`

                                    const mailOptions = {
                                        from: EMAIL_FROM,
                                        to: usuarioSalvo.email,
                                        subject: 'Confirmação de e-mail - Notícias',
                                        html: `
                                            <h1>Olá ${nomeUsuario}</h1>
                                            <h2>Confirmação de e-mail</h2>
                                            <p>Obrigado por se inscrever em nosso portal de notícias!</p>
                                            <p>Por favor, clique no link abaixo para confirmar seu e-mail:</p>
                                            <a href="${linkConfirmacao}">Confirmar e-mail</a>
                                        `
                                    }

                                    const enviado = await sendEmailSafe(mailOptions)

                                    if (enviado) {
                                        req.flash(
                                            'success_msg',
                                            'Uma confirmação foi enviada para o seu e-mail! Confirme em até 10 minutos.'
                                        )
                                    } else {
                                        req.flash(
                                            'success_msg',
                                            isFirstUser
                                                ? 'Conta de Administrador criada com sucesso! Faça login para acessar.'
                                                : 'Conta criada com sucesso! Faça login para acessar.'
                                        )
                                    }
                                    res.redirect('/users/login')
                                })
                                .catch((err) => {
                                    console.error(err)
                                    req.flash('error_msg', 'Houve um erro ao criar o usuário, tente novamente!')
                                    res.redirect('/users/registro')
                                })
                        })
                    })
                })
            })
            .catch((err) => {
                console.error(err)
                req.flash('error_msg', 'Houve um erro interno!')
                res.redirect('/users/registro')
            })
    }
})

// Login
router.get('/login', (req, res) => {
    res.render('usuario/login')
})

router.post('/login', (req, res, next) => {
    passport.authenticate('local', {
        successRedirect: '/',
        failureRedirect: '/users/login',
        failureFlash: true
    })(req, res, next)
})

// Logout
router.get('/sair', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err)
        }
        req.flash('success_msg', 'Sucesso ao desconectar da conta!')
        res.redirect('/')
    })
})

// Listagem Admin de Usuários
router.get('/', Admin, (req, res) => {
    User.find()
        .sort({ data: 'desc' })
        .lean()
        .then((users) => {
            res.render('admin/usuarios/usuarios', { users: users })
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao listar os usuários.')
            res.redirect('/admin')
        })
})

router.post('/deletar', Admin, (req, res) => {
    User.findByIdAndDelete(req.body.id)
        .then(() => {
            req.flash('success_msg', 'Usuário deletado com sucesso!')
            res.redirect('/users')
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Houve um erro ao deletar o usuário!')
            res.redirect('/users')
        })
})

router.post('/edit', Admin, (req, res) => {
    User.findById(req.body.id)
        .then((user) => {
            if (!user) {
                req.flash('error_msg', 'Esse usuário não existe')
                return res.redirect('/users')
            }
            user.Admin = true
            return user.save().then(() => {
                req.flash('success_msg', 'Definido como Admin com sucesso!')
                res.redirect('/users')
            })
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Ocorreu um erro ao definir como Admin')
            res.redirect('/users')
        })
})

// Informações do Usuário + Histórico de Curtidas e Comentários
router.get('/usuario/:id', Register, async (req, res) => {
    if (!req.params.id) {
        req.flash('error_msg', 'ID de usuário inválido.')
        return res.redirect('/')
    }

    const isOwnProfile = String(req.user._id) === String(req.params.id)
    const isAdmin = req.user.Admin === true || req.user.Admin == 1

    if (!isOwnProfile && !isAdmin) {
        req.flash('error_msg', 'Você não tem permissão para visualizar este perfil.')
        return res.redirect('/')
    }

    try {
        const user = await User.findById(req.params.id).lean()
        if (!user) {
            req.flash('error_msg', 'Esse usuário não existe.')
            return res.redirect('/')
        }

        const [meusComentarios, todasPostagens] = await Promise.all([
            Comentario.find({ userId: String(user._id) }).lean(),
            Postagem.find().populate('categoria').lean()
        ])

        const postagensCurtidas = (todasPostagens || []).filter(
            (p) => Array.isArray(p.likedBy) && p.likedBy.map(String).includes(String(user._id))
        )

        res.render('admin/usuarios/info', {
            user: user,
            isOwnProfile: isOwnProfile,
            meusComentarios: meusComentarios || [],
            postagensCurtidas: postagensCurtidas
        })
    } catch (err) {
        console.error(err)
        req.flash('error_msg', 'Esse usuário não existe.')
        res.redirect('/')
    }
})

// Atualizar nome do perfil
router.post('/perfil/editar', Register, async (req, res) => {
    const novoNome = (req.body.nome || '').trim()
    const userId = String(req.user._id)

    if (!novoNome || novoNome.length < 2) {
        req.flash('error_msg', 'Insira um nome válido!')
        return res.redirect(`/users/usuario/${userId}`)
    }

    try {
        await User.findByIdAndUpdate(userId, { nome: novoNome })
        req.flash('success_msg', 'Dados do perfil atualizados com sucesso!')
        res.redirect(`/users/usuario/${userId}`)
    } catch (err) {
        console.error(err)
        req.flash('error_msg', 'Erro ao atualizar perfil.')
        res.redirect(`/users/usuario/${userId}`)
    }
})

// Confirmar E-mail
router.get('/confirm/:id', (req, res) => {
    const userId = req.params.id
    if (!userId) {
        req.flash('error_msg', 'Link de confirmação inválido!')
        return res.redirect('/')
    }

    User.findByIdAndUpdate(userId, { confirm: true })
        .then((user) => {
            if (!user) {
                req.flash('error_msg', 'Esse usuário não existe')
                res.redirect('/')
            } else {
                req.flash('success_msg', 'E-mail confirmado com sucesso! Faça login para acessar sua conta!')
                res.redirect('/users/login')
            }
        })
        .catch((err) => {
            console.error(err)
            req.flash('error_msg', 'Ocorreu um erro ao confirmar o e-mail')
            res.redirect('/')
        })
})

// Recuperar Senha (Seguro com Token Criptográfico e Expiração)
router.get('/password', (req, res) => {
    res.render('usuario/password')
})

router.post('/password', async (req, res) => {
    const nome = (req.body.nome || '').trim()
    const email = (req.body.email || '').trim().toLowerCase()

    if (!nome) {
        req.flash('error_msg', 'Insira seu nome de usuário!')
        return res.redirect('/users/password')
    }
    if (!email) {
        req.flash('error_msg', 'Insira seu e-mail!')
        return res.redirect('/users/password')
    }

    try {
        const user = await User.findOne({ email: email })
        if (!user) {
            req.flash('error_msg', 'Esse usuário não existe!')
            return res.redirect('/users/password')
        }

        const token = crypto.randomBytes(24).toString('hex')
        user.resetPasswordToken = token
        user.resetPasswordExpires = new Date(Date.now() + 3600000) // 1 hora
        await user.save()

        const resetUrl = `${BASE_URL}/users/password/recuperar/${token}`
        const mailOptions = {
            from: EMAIL_FROM,
            to: user.email,
            subject: 'Recuperar senha - Notícias',
            html: `
                <h1>Olá ${user.nome}</h1>
                <h2>Recuperar senha</h2>
                <p>Recebemos uma solicitação para redefinir sua senha.</p>
                <p>Clique no link abaixo para criar uma nova senha (válido por 1 hora):</p>
                <a href="${resetUrl}">Recuperar senha!</a>
            `
        }

        const enviado = await sendEmailSafe(mailOptions)

        if (enviado) {
            req.flash('success_msg', 'Verifique seu e-mail para recuperar a senha!')
            return res.redirect('/users/login')
        } else {
            req.flash('success_msg', 'Modo de desenvolvimento (sem SMTP): defina sua nova senha abaixo.')
            return res.redirect(`/users/password/recuperar/${token}`)
        }
    } catch (err) {
        console.error(err)
        req.flash('error_msg', 'Ocorreu um erro ao recuperar a senha')
        res.redirect('/')
    }
})

// Tela de redefinição via token seguro (GET e POST)
router.get('/password/recuperar/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() }
        }).lean()

        if (!user) {
            req.flash('error_msg', 'Token de recuperação inválido ou expirado!')
            return res.redirect('/users/password')
        }

        res.render('usuario/recuperar', { user: user, token: req.params.token })
    } catch (err) {
        console.error(err)
        req.flash('error_msg', 'Erro ao validar token de recuperação.')
        res.redirect('/users/password')
    }
})

router.post('/password/alterar', async (req, res) => {
    const token = req.body.token
    const senha = req.body.senha || ''
    const senha2 = req.body.senha2 || ''

    if (!token) {
        req.flash('error_msg', 'Token de segurança ausente!')
        return res.redirect('/users/password')
    }

    if (!senha || senha.length <= 4) {
        req.flash('error_msg', 'A nova senha deve ter no mínimo 5 caracteres!')
        return res.redirect(`/users/password/recuperar/${token}`)
    }

    if (senha !== senha2) {
        req.flash('error_msg', 'Insira duas senhas iguais!')
        return res.redirect(`/users/password/recuperar/${token}`)
    }

    try {
        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        })

        if (!user) {
            req.flash('error_msg', 'Token de recuperação inválido ou expirado!')
            return res.redirect('/users/password')
        }

        const salt = await bcrypt.genSalt(10)
        user.senha = await bcrypt.hash(senha, salt)
        user.resetPasswordToken = null
        user.resetPasswordExpires = null
        await user.save()

        req.flash('success_msg', 'Senha alterada com sucesso! Faça login com sua nova senha.')
        res.redirect('/users/login')
    } catch (err) {
        console.error(err)
        req.flash('error_msg', 'Houve um erro ao salvar a nova senha!')
        res.redirect('/users/login')
    }
})

module.exports = router
