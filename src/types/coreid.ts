// tokenURI解析出的metadata（JVCore和POPBadge的tokenURI都返回这个结构，字段不同）
export interface NFTMetadata {
  name: string
  description?: string
  image: string // data:image/svg+xml;base64,...
  // JVCore.tokenURI 专属字段
  liveness?: boolean
  lastCheckInTime?: number // unix秒
  lastCheckInBlock?: number
  // POPBadge.tokenURI 专属字段
  coreId?: number
  checkInBlockNumber?: number
  checkInTimestamp?: number
}

export interface CoreIdInfo {
  tokenId: bigint
  metadata: NFTMetadata | null
}

export interface PopHistoryEntry {
  tokenId: bigint
  metadata: NFTMetadata | null
  monthLabel: string // "YY.M"，如 "26.6"
  isValid: boolean // 代打卡判断：metadata.coreId === 当前Core ID
  /** 失效成因（isValid=false 时）：metadata=元数据读取失败 / no-core-id=本地址未持有Core ID / mismatch=记录不符 */
  invalidReason: 'metadata' | 'no-core-id' | 'mismatch' | null
}
