import { Client, SimpleCommandMessage } from 'discordx'
import { delay, inject, singleton } from 'tsyringe'
import { EntityRepository } from '@mikro-orm/core'
import { constant } from 'case'
import osu from 'node-os-utils'

import { Database, WebSocket } from '@services'
import { Guild, Stat, User } from '@entities'
import { formatDate, getTypeOfInteraction, resolveAction, resolveChannel, resolveGuild, resolveUser, datejs, isInMaintenance } from '@utils/functions'
import { Schedule, WSOn } from '@decorators'

import { statsConfig } from '@config'
import pidusage from 'pidusage'
import { ContextMenuInteraction } from 'discord.js'

const allInteractions = { 
    $or: [ 
        { type: 'SIMPLE_COMMAND_MESSAGE' }, 
        { type: 'COMMAND_INTERACTION' },
        { type: 'USER_CONTEXT_MENU_INTERACTION' },
        { type: 'MESSAGE_CONTEXT_MENU_INTERACTION' },
    ] 
}

@singleton()
export class Stats {

    private statsRepo: EntityRepository<Stat>

    constructor(
        private client: Client,
        private db: Database,
        @inject(delay(() => WebSocket)) private ws: WebSocket
    ) {
        this.statsRepo = this.db.getRepo(Stat)
    }

    /**
     * Add an entry to the stats table.
     * @param type 
     * @param value 
     * @param additionalData in JSON format
     */
    async register(type: string, value: string, additionalData?: any) {

        const stat = new Stat()
        stat.type = type
        stat.value = value
        if (additionalData) stat.additionalData = additionalData

        await this.statsRepo.persistAndFlush(stat)
    }

    /**
     * Record an interaction and add it to the database.
     * @param interaction 
     * @returns 
     */
    async registerInteraction(interaction: AllInteractions) {

        // we extract data from the interaction
        const type = constant(getTypeOfInteraction(interaction)) as InteractionsConstants
        if (statsConfig.interaction.exclude.includes(type)) return
        
        const value = resolveAction(interaction)
        const additionalData = {
            user: resolveUser(interaction)?.id,
            guild: resolveGuild(interaction)?.id || 'dm',
            channel: resolveChannel(interaction)?.id
        }

        // add it to the db
        await this.register(type, value, additionalData)
    }

    /**
     * Record a simple command message and add it to the database.
     * @param command 
     */
    async registerSimpleCommand(command: SimpleCommandMessage) {

        // we extract data from the interaction
        const type = 'SIMPLE_COMMAND_MESSAGE'
        const value = command.name
        const additionalData = {
            user: command.message.author.id,
            guild: command.message.guild?.id || 'dm',
            channel: command.message.channel?.id
        }

        // add it to the db
        await this.register(type, value, additionalData)
    }

    /**
     * Returns an object with the total stats for each type
     */
    async getTotalStats() {

        const totalStatsObj = {
            TOTAL_USERS: this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
            TOTAL_GUILDS: this.client.guilds.cache.size,
            TOTAL_ACTIVE_USERS: await this.db.getRepo(User).count(),
            TOTAL_COMMANDS: await this.statsRepo.count(allInteractions)
        }

        return totalStatsObj
    }

    async getLastInteraction() {

        const lastInteraction = await this.statsRepo.findOne(allInteractions, {
            orderBy: { createdAt: 'DESC' }
        })

        return lastInteraction
    }

    async getTopCommands() {

        const qb = this.db.em.createQueryBuilder(Stat)
        const query = qb
            .select(['type', 'value', 'count(*) as count'])
            .where(allInteractions)
            .groupBy(['type', 'value'])

        const slashCommands = await query.execute()
        return slashCommands
    }

    async getUsersActivity() {

        const usersActivity = {
            '1-10': 0,
            '11-50': 0,
            '51-100': 0,
            '101-1000': 0,
            '>1000': 0
        }

        const users = await this.db.getRepo(User).findAll()

        for (const user of users) {

            const commandsCount = await this.db.getRepo(Stat).count({
                ...allInteractions,
                additionalData: {
                    user: user.id
                }
            })

            if (commandsCount <= 10) usersActivity['1-10']++
            else if (commandsCount <= 50) usersActivity['11-50']++
            else if (commandsCount <= 100) usersActivity['51-100']++
            else if (commandsCount <= 1000) usersActivity['101-1000']++
            else usersActivity['>1000']++
        }

        return usersActivity
    }

    async getTopGuilds() {

        const topGuilds: {
            id: string,
            name: string,
            totalCommands: number
        }[] = []

        const guilds = await this.db.getRepo(Guild).findAll()

        for (const guild of guilds) {

            const discordGuild = this.client.guilds.cache.get(guild.id)

            const commandsCount = await this.db.getRepo(Stat).count({
                ...allInteractions,
                additionalData: {
                    guild: guild.id
                }
            })

            topGuilds.push({
                id: guild.id,
                name: discordGuild?.name || '',
                totalCommands: commandsCount
            })
        }

        return topGuilds
    }

    /**
     * Returns the amount of row for a given type per day in a given interval of days from now.
     * @param type 
     * @param days 
     */
    async countStatsPerDays(type: string, days: number): Promise<StatPerInterval> {

        const now = Date.now()
        const stats: StatPerInterval = []

        for (let i = 0; i < days; i++) {

            const date = new Date(now - (i * 24 * 60 * 60 * 1000))
            const statCount = await this.getCountForGivenDay(type, date)

            stats.push({
                date: formatDate(date, 'onlyDate'),
                count: statCount
            })
        }

        return this.cummulateStatPerInterval(stats)
    }

    /**
     * Transform individual day stats into cumulated stats.
     * @param stats 
     */
    cummulateStatPerInterval(stats: StatPerInterval): StatPerInterval {

        const cummulatedStats = 
            stats
                .reverse()
                .reduce((acc, stat, i) => {

                    if (acc.length === 0) acc.push(stat)
                    else acc.push({
                        date: stat.date,
                        count: acc[i - 1].count + stat.count
                    })
                
                    return acc
                }, [] as StatPerInterval)
                .reverse()

        return cummulatedStats
    }

    /**
     * Sum two array of stats.
     * @param stats1 
     * @param stats2 
     * @returns 
     */
    sumStats(stats1: StatPerInterval, stats2: StatPerInterval): StatPerInterval {

        const allDays = [...new Set(stats1.concat(stats2).map(stat => stat.date))]
            .sort((a, b) => {
                var aa = a.split('/').reverse().join(),
                    bb = b.split('/').reverse().join();
                return aa < bb ? -1 : (aa > bb ? 1 : 0);
            })

        const sumStats = allDays.map(day => ({
            date: day,
            count: 
            (stats1.find(stat => stat.date === day)?.count || 0) 
            + (stats2.find(stat => stat.date === day)?.count || 0)
        }))

        return sumStats
    }

    /**
     * Returns the total count of row for a given type at a given day.
     * @param type 
     * @param date - day to get the stats for (any time of the day will work as it extract the very beginning and the very ending of the day as the two limits)
     */
    async getCountForGivenDay(type: string, date: Date): Promise<number> {

        const start = datejs(date).startOf('day').toDate()
        const end = datejs(date).endOf('day').toDate()

        const stats = await this.statsRepo.find({
            type,
            createdAt: {
                $gte: start,
                $lte: end
            }   
        })

        return stats.length
    }

    /**
     * Get the current process usage (CPU, RAM, etc)
     */
    async getPidUsage() {

        const pidUsage = await pidusage(process.pid)

        return {
            ...pidUsage,
            cpu: pidUsage.cpu.toFixed(1),
            memory: {
                usedInMb: (pidUsage.memory / (1024 * 1024)).toFixed(1),
                percentage: (pidUsage.memory / osu.mem.totalMem() * 100).toFixed(1)
            }
        }
    }

    /**
     * Get the current host health (CPU, RAM, etc)
     */
    async getHostUsage() {

        return {
            cpu: await osu.cpu.usage(),
            memory: await osu.mem.info(),
            os: await osu.os.oos(),
            uptime: await osu.os.uptime(),
            hostname: await osu.os.hostname(),
            platform: await osu.os.platform()
            // drive: osu.drive.info(),
        }
    }

    getLatency() {

        return {
            ping: this.client.ws.ping
        }
    }

    /**
     * Run each day at 23:59 to update daily stats
     */
    @Schedule('59 23 * * *')
    async registerDailyStats() {

        const totalStats = await this.getTotalStats()
        
        for (const type of Object.keys(totalStats)) {
            const value = JSON.stringify(totalStats[type as keyof typeof totalStats])
            await this.register(type, value)
        }
    }

    // ORDER OF DECORATORS IS IMPORTANT! 
    @WSOn('getHealth')
    @Schedule('*/5 * * * * *')
    async sendWebSocketHealth(response?: WSResponseFunction) {

        const data = {
            botStatus: {
                online: true,
                uptime: this.client.uptime,
                maintenance: await isInMaintenance()
            },
            host: await this.getHostUsage(),
            pid: await this.getPidUsage(),
            latency: this.getLatency()
        }

        if (response) response('monitoring', data)
        else this.ws.broadcast('monitoring', data)
    }

}