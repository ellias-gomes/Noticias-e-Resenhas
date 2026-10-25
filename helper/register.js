module.exports = {
    Register: (req, res, next) => {
        if (req.isAuthenticated() && req.user != null) {
            return next()
        }
        req.flash('error_msg', 'Você precisa estar logado!')
        res.redirect('/users/login')
    }
}
