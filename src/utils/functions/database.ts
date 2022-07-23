import { container } from 'tsyringe'

import { Database } from '@services'
import { Data } from '@entities'
import { defaultData } from 'src/entities/Data'

type DataType = keyof typeof defaultData

/**
 * Initiate the EAV Data table if properties defined in the `defaultData` doesn't exist in it yet.
 */
export const initDataTable = async () => {

    const db = container.resolve(Database)

    for (const key of Object.keys(defaultData)) {

        const dataRepository = db.getRepo(Data)

        await dataRepository.add(
            key as DataType, 
            defaultData[key as DataType]
        )
    }
}