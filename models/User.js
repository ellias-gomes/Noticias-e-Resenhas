const mongoose = require('mongoose')
const Schema = mongoose.Schema

const UserSchema = new Schema({
    nome: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    Admin: {
        type: Boolean,
        default: false
    },
    senha: {
        type: String,
        required: true
    },
    avatar: {
        type: String,
        default: ''
    },
    confirm: {
        type: Boolean,
        default: false
    },
    resetPasswordToken: {
        type: String,
        default: null
    },
    resetPasswordExpires: {
        type: Date,
        default: null
    },
    data: {
        type: Date,
        default: Date.now
    }
})

if (!mongoose.models.users) {
    mongoose.model('users', UserSchema)
}

module.exports = UserSchema
