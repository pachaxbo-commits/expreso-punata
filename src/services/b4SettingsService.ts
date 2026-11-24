import { observedHttpsCallable as httpsCallable } from '../firebase/observedCallable.ts'
import { functions } from '../firebase/config'

type B4Response = { items: { kind: string; value?: any; effective?: any; version: number }[] }
const getSettings = httpsCallable<void, B4Response>(functions, 'getB4Settings')

export async function getB4Setting(kind: string) {
  const response = await getSettings()
  return response.data.items.find(item => item.kind === kind)
}
