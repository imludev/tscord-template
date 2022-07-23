import { Get, Middleware, Post, Router } from "@discordx/koa"
import { injectable } from "tsyringe"
import { Context } from "koa"
import validator, { Joi } from "koa-context-validator"

import { Database } from "@services"
import { BaseController } from "@utils/classes"
import { formatDate } from "@utils/functions"

import { databaseConfig } from "@config"
import { authenticated } from "@api/middlewares"

@Router({ options: { prefix: "/database" } })
@Middleware(
    authenticated
)
@injectable()
export class DatabaseController extends BaseController {

    constructor(
        private readonly db: Database
    ) {
        super()
    }

    @Post('/backup')
    async generateBackup(ctx: Context) {

        const snapshotName = `snapshot-${formatDate(new Date(), 'onlyDateFileName')}-manual-${Date.now()}`
        const success = await this.db.backup(snapshotName)

        if (success) this.ok(ctx.response, { 
            message: "Backup generated",
            data: {
                snapshotName
            }
        })
        else this.error(ctx.response, "Couldn't generate backup, see the logs for more informations", 500)

    }

    @Post('/restore')
    @Middleware(
        validator({
            body: Joi.object().keys({
                snapshotName: Joi.string().required()
            })
        })
    )
    async restoreBackup(ctx: Context) {
        
        const data = <{ snapshotName: string }>ctx.request.body

        const success = await this.db.restore(data.snapshotName)

        if (success) this.ok(ctx.response, { message: "Backup restored" })
        else this.error(ctx.response, "Couldn't restore backup, see the logs for more informations", 500)
    }

    @Get('/backup/list')
    async getBackupList(ctx: Context) {

        const backupPath = databaseConfig.backup.path
        if (!backupPath) {
            return this.error(ctx.response, "Couldn't list backups, see the logs for more informations", 500)
        }

        const backupList = this.db.getBackupList()

        if (backupList) this.ok(ctx.response, backupList)
        else this.error(ctx.response, "Couldn't list backups, see the logs for more informations", 500)
    }
}