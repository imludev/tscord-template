import { generalConfig } from "@config"

/**
 * Get a curated list of devs including the owner id
 */
export const getDevs = (): string[] => {

    return [...generalConfig.devs, generalConfig.ownerId]
}

/**
 * Check if a given user is a dev with its ID
 * @param id Discord user id
 */
export const isDev = (id: string): boolean => {

    return getDevs().includes(id)
}