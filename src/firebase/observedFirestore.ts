import {
  getDoc as firebaseGetDoc,
  getDocs as firebaseGetDocs,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore'
import { reportObservedError } from './observedCallable.ts'

function appendIncident(error: unknown, id: string | null) {
  if (id && error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    try { Object.defineProperty(error, 'message', { configurable: true, value: `${error.message} (Incidencia: ${id})` }) } catch {}
  }
}

export async function getDoc<AppModelType, DbModelType extends DocumentData>(
  reference: DocumentReference<AppModelType, DbModelType>,
): Promise<DocumentSnapshot<AppModelType, DbModelType>> {
  try { return await firebaseGetDoc(reference) }
  catch (error) {
    appendIncident(error, await reportObservedError(error, { module: 'other', operation: 'firestoreGetDoc' }))
    throw error
  }
}

export async function getDocs<AppModelType, DbModelType extends DocumentData>(
  query: Query<AppModelType, DbModelType>,
): Promise<QuerySnapshot<AppModelType, DbModelType>> {
  try { return await firebaseGetDocs(query) }
  catch (error) {
    appendIncident(error, await reportObservedError(error, { module: 'other', operation: 'firestoreGetDocs' }))
    throw error
  }
}
