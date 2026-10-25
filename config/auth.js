const localStrategy = require('passport-local').Strategy
const bcrypt = require('bcryptjs')
const { User } = require('../models')

module.exports = function (passport) {
    passport.use(
        new localStrategy(
            { usernameField: 'email', passwordField: 'senha' },
            (email, senha, done) => {
                User.findOne({ email: email.trim().toLowerCase() })
                    .lean()
                    .then((user) => {
                        if (!user) {
                            return done(null, false, { message: 'Esta conta não existe' })
                        }
                        bcrypt.compare(senha, user.senha, (erro, batem) => {
                            if (erro) {
                                return done(erro)
                            }
                            if (batem) {
                                return done(null, user, { message: 'Sucesso ao entrar na conta' })
                            } else {
                                return done(null, false, { message: 'Senha incorreta' })
                            }
                        })
                    })
                    .catch((err) => done(err))
            }
        )
    )

    passport.serializeUser((user, done) => {
        done(null, user._id)
    })

    passport.deserializeUser((id, done) => {
        User.findById(id)
            .lean()
            .then((user) => {
                done(null, user)
            })
            .catch((err) => {
                done(err, null)
            })
    })
}
