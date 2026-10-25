module.exports = {
    Confirm: (req, res, next) => {
        if (req.isAuthenticated() && req.user && req.user.confirm === true) {
            return next()
        }
        req.flash('error_msg', 'Confirme seu e-mail antes de continuar!')
        res.redirect('/')
    }
}
