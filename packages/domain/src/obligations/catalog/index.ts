import type { CatalogEntry } from '../catalog-types'
import { TAX_CATALOG } from './tax'
import { SOCIAL_SECURITY_CATALOG } from './social-security'
import { INDIVIDUAL_CATALOG } from './individual'

export const FISCAL_CATALOG: CatalogEntry[] = [...TAX_CATALOG, ...SOCIAL_SECURITY_CATALOG, ...INDIVIDUAL_CATALOG]
