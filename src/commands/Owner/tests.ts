import { ApplicationCommandType, CommandInteraction } from "discord.js"

import { ContextMenu, Discord, Slash } from "@decorators"
import { Disabled, Guard } from "@guards"

@Discord()
export default class TestsCommand {

	@Slash('test')
	@Guard(
		Disabled
	)
	async test(interaction: CommandInteraction) {

		console.log('test invoked')
	}

	@ContextMenu(ApplicationCommandType.User, 'help')
	async contextMenu(interaction: CommandInteraction) {
		
		console.log('contextMenu invoked')
	}
}