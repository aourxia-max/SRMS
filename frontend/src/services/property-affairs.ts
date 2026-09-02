import type {
  PropertyAffairCreatePayload,
  PropertyAffairDetail,
  PropertyAffairListQuery,
  PropertyAffairUploadFile,
  PropertyAffairPaginatedResponse,
  PropertyAffairProgressPayload,
  PropertyAffairResponsibleUserOption,
  PropertyAffairSummary,
  PropertyAffairUpdatePayload,
} from '../types/property-affairs'
import { http } from './http'

type ApiEnvelope<T> = { code: number; message: string; data: T }
const unwrap = <T>(response: { data: ApiEnvelope<T> }) => response.data.data

export async function listPropertyAffairs(query: PropertyAffairListQuery = {}) {
  return unwrap(await http.get<ApiEnvelope<PropertyAffairPaginatedResponse<PropertyAffairSummary>>>('/property-affairs', { params: query }))
}
export async function getPropertyAffair(id: number) { return unwrap(await http.get<ApiEnvelope<PropertyAffairDetail>>(`/property-affairs/${id}`)) }
export async function listPropertyAffairCategories() { return unwrap(await http.get<ApiEnvelope<string[]>>('/property-affairs/categories')) }
export async function listPropertyAffairResponsibleUsers() { return unwrap(await http.get<ApiEnvelope<PropertyAffairResponsibleUserOption[]>>('/property-affairs/responsible-users')) }
export async function createPropertyAffair(payload: PropertyAffairCreatePayload) { return unwrap(await http.post<ApiEnvelope<PropertyAffairDetail>>('/property-affairs', payload)) }
export async function updatePropertyAffair(id: number, payload: PropertyAffairUpdatePayload) { return unwrap(await http.patch<ApiEnvelope<PropertyAffairDetail>>(`/property-affairs/${id}`, payload)) }
export async function appendPropertyAffairProgress(id: number, payload: PropertyAffairProgressPayload) { return unwrap(await http.post<ApiEnvelope<PropertyAffairDetail>>(`/property-affairs/${id}/progress`, payload)) }
export async function softDeletePropertyAffair(id: number, version: number) { return unwrap(await http.delete<ApiEnvelope<PropertyAffairDetail>>(`/property-affairs/${id}`, { data: { version } })) }
export async function restorePropertyAffair(id: number, version: number) { return unwrap(await http.post<ApiEnvelope<PropertyAffairDetail>>(`/property-affairs/${id}/restore`, { version })) }
export async function permanentlyDeletePropertyAffair(id: number, version: number) { return unwrap(await http.delete<ApiEnvelope<{ id: number }>>(`/property-affairs/${id}/permanent`, { data: { version } })) }
export async function uploadPropertyAffairFile(id: number, file: File) { const body = new FormData(); body.append('file', file); return unwrap(await http.post<ApiEnvelope<PropertyAffairUploadFile>>(`/property-affairs/${id}/files`, body)) }
export async function previewPropertyAffairFile(id: number, fileId: number) { return (await http.get(`/property-affairs/${id}/files/${fileId}/preview`, { responseType: 'blob' })).data as Blob }
export async function downloadPropertyAffairFile(id: number, fileId: number) { return (await http.get(`/property-affairs/${id}/files/${fileId}/download`, { responseType: 'blob' })).data as Blob }
export async function unlinkPropertyAffairFile(id: number, fileId: number) { return unwrap(await http.delete<ApiEnvelope<{ id: number }>>(`/property-affairs/${id}/files/${fileId}`)) }

export function extractPropertyAffairErrorMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  if (Array.isArray(message)) {
    const chineseMessages = message.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    if (chineseMessages.length) return chineseMessages.join('；')
  }
  if (typeof message === 'string' && message.trim()) return message
  return fallback
}
