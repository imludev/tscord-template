import { container } from "tsyringe"
import { Context, Next } from "koa"
import DiscordOauth2 from "discord-oauth2"

import { isDev } from "@utils/functions"
import { Store } from "@services"

const discordOauth2 = new DiscordOauth2()
const store = container.resolve(Store)

const timeout = 10 * 60 * 1000
const fmaTokenRegex = /mfa\.[\w-]{84}/
const nonFmaTokenRegex = /[\w-]{24}\.[\w-]{6}\.[\w-]{27}/

export async function authenticated(ctx: Context, next: Next) {

    // if we are in development mode, we don't need to check the token
    // if (process.env['NODE_ENV'] === 'development') return next()

    // check if the request includes valid authorization header
    const authHeader = ctx.headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) return ctx.throw(400, 'Missing token')

    // get the token from the authorization header
    const token = authHeader.split(' ')[1]
    if (!token) return ctx.throw(400, 'Invalid token')

    // pass if the token is the admin token of the app
    if (token === process.env['API_ADMIN_TOKEN']) return next()
    
    // verify that the token is a valid FMA protected (or not) OAuth2 token -> https://stackoverflow.com/questions/71166596/is-there-a-way-to-check-if-a-discord-account-token-is-valid-or-not
    if (!token.match(fmaTokenRegex) && !token.match(nonFmaTokenRegex)) return ctx.throw(400, 'Invalid token')

    // directly skip the middleware if the token is already in the store, which is used here as a "cache"
    const authorizedAPITokens = store.get('authorizedAPITokens')
    if (authorizedAPITokens.includes(token)) return next()
    
    // we get the user's profile from the token using the `discord-oauth2` package
    discordOauth2.getUser(token)
    .then(user => {

        // throw error if the user is not dev on the bot
        if (!isDev(user.id)) return ctx.throw(401, 'Unauthorized')

        // we add the token to the store and set a timeout to remove it after 10 minutes
        store.update('authorizedAPITokens', (authorizedAPITokens) => [...authorizedAPITokens, token])
        setTimeout(() => {
            store.update('authorizedAPITokens', (authorizedAPITokens) => authorizedAPITokens.filter(t => t !== token))
        }, timeout)

        next()

    })
    .catch(error => {
        ctx.throw(400, 'Invalid token')
    })
}