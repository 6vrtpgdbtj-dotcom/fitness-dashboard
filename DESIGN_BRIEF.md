# Design Brief

## Product job

지점 관리자가 형식이 다른 Google Sheets와 트레이너 명단을 입력해 PT 팀/개인 매출과 수업·회원 상태를 실시간으로 확인하고 즉시 운영 판단을 내린다.

## Direction

넓은 PT 매출 무대와 좁은 운영 레일을 결합한 호텔 라운지형 대시보드: 따뜻한 아이보리, 차콜, 브론즈로 위계를 만들고 반복 사용에 필요한 밀도는 유지한다.

## Brand reading

- Immutable identity: 1986 FITNESS 중산점, PT 팀 중심, 직접적인 한국어 운영 용어, 실제 시트 수치.
- Repeatable shapes/materials: 브론즈 세로선, 차콜 레일, 아이보리 원장 표면, 얇은 디바이더, 4–8px 반경.
- Existing inconsistencies to remove: 동일 크기 어두운 카드 반복, 라임색 과사용, PT 팀 매출과 보조 지표의 약한 위계.
- Media provenance: 외부 호텔 사진·로고를 사용하지 않으며 현재의 타이포그래픽 `86` 마크만 유지한다.

## Reference synthesis

- Structure comes from: 현재 앱의 검증된 운영 흐름과 비대칭 운영 대시보드 구성.
- Interaction comes from: Motion for React의 coordinated variants, layout/hover/focus 상태.
- Visual tone comes from: KTGY The Gwen의 아이보리·밍크 그레이·차콜 대비와 브론즈/아르데코 소재 원칙.
- Hook/copy energy comes from: 가장 중요한 PT 팀 매출을 첫 시선에 제시하는 실제 업무 우선순위.
- Motion/media behavior comes from: Motion의 숫자·레이아웃 갱신 및 입력 방식에 맞는 hover 처리.
- The final screen will not copy: 호텔 브랜드명, 사진, 장식 패턴, 예약 화면, 고유 레이아웃 또는 유료 Motion+ 컴포넌트.

## Reference evidence

- KTGY `The Gwen — A Luxury Collection Hotel`, 2026-09-11 확인. 객실의 아이보리/밍크 그레이/차콜 대비와 공용부의 브론즈 세로 금속 디테일을 색상 역할과 얇은 데이터 디바이더로 번역한다. 호텔 사진, 조형물, 로고는 사용하지 않는다.
- Motion for React `Animation` 및 `Hover animation`, 2026-09-11 확인. 선언형 값 변화, 순차 애니메이션, layout transition, 터치에서 가짜 hover를 걸러내는 동작을 확인했다. PT 매출 수치→분해 막대→트레이너 행의 순서형 등장과 선택 피드백에 적용한다.
- 현재 앱 `/dashboard`, `/classes`, 2026-09-11 확인. 좌측 운영 레일, 기간 필터, 실제 데이터 영역은 유지하되 PT 매출을 주인공으로 재배치하고 수업 정렬을 명시적으로 보정한다.

## Reference implementation map

| Reference evidence | Extracted principle | Local component | Motion/state | Mobile translation | Acceptance evidence |
|---|---|---|---|---|---|
| The Gwen 객실의 아이보리/차콜, 공용부 브론즈 수직 디테일 | 중립 면적 대비와 금속성 얇은 강조 | `src/app/globals.css`, `src/components/app-shell.tsx` | 포커스·선택 시 브론즈 선과 표면 대비 | 차콜 레일을 하단 내비로 바꾸고 브론즈 선택선을 유지 | 1440px/390px 첫 화면 캡처 |
| 현재 대시보드의 기간/동기화/운영 큐 | 검증된 업무 흐름과 상태 유지 | `dashboard-view.tsx`, `sync-pulse.tsx`, `renewal-table.tsx` | 동기화 성공·부분 실패 상태 전환 | PT→오늘→재등록→개인 실적 순으로 재배치 | 정상·빈·부분 실패 캡처 |
| Motion Animation의 sequence/layout transition | 수치와 근거를 순차적으로 이해 | `dashboard-motion.tsx`, `revenue-chart.tsx` | PT 총액→신규/재등록→트레이너 행, 220–320ms | 이동 거리를 줄이고 최종 레이아웃 즉시 안정화 | 5–10초 모션 증거 및 reduced-motion 캡처 |
| Motion Hover의 입력 방식 구분 | 포인터·키보드에만 명확한 피드백 | 내비, 필터, 표 행, 차트 선택 | hover, focus-visible, selected 140–180ms | touch에서는 sticky hover 없이 pressed/selected만 표시 | 키보드 포커스 및 모바일 상호작용 확인 |
| 실제 매출시트의 트레이너 상위 제목/담당자 배정 하위 블록 | 상위 담당자 컨텍스트가 다음 경계까지 하위 매출에 상속 | `sheet-pipeline.ts`, `normalize-registration.ts` | 충돌 시 개인 배정 보류, 팀 합계 유지 | 화면에 담당 미지정 상태를 축약 표시 | 구조별 파서 fixture와 실제 동기화 대조 |
| 현재 `/classes` 표 | 날짜와 시간의 업무 순서 분리 | `today-classes.tsx`, `detail-view.tsx` | 행 hover 및 완료 상태 전환 | 핵심 열을 읽기 순서형 행으로 변환 | 한국시간 정렬 테스트와 390px 캡처 |

## Signature composition and component

- Signature composition: 넓은 `PT Revenue Ledger`와 좁은 차콜 운영 레일이 이루는 비대칭 호텔 프런트 데스크 구성.
- Signature component: PT 팀 총액, 신규·재등록 분해, 트레이너 기여와 시트 분류를 연결하는 `PT Revenue Ledger`.

## Motion storyboard

| Beat | Trigger | Elements | From → to | Duration/ease | Purpose | Reduced motion |
|---|---|---|---|---|---|---|
| Establish revenue | dashboard load | PT total, split bars, trainer rows | opacity/y/scale 0.96 → final | 220ms + 60ms stagger, ease-out | 합계에서 근거로 시선 이동 | 최종 상태 즉시 표시 |
| Refresh ledger | period or realtime update | totals, chart marks, timestamp | previous geometry → current | 260ms ease-in-out | 값 변화 위치 보존 | 즉시 교체 |
| Select owner | trainer/filter selection | selected row and related series | neutral → bronze emphasis | 180ms ease-out | 개인과 팀 근거 연결 | 색/테두리만 변경 |
| Inspect row | hover/focus | navigation, table row, action | surface/line 0 → emphasized | 140ms ease-out | 조작 가능성 표시 | focus ring 유지 |

## References

| Role | Source | Adapt | Do not copy |
|---|---|---|---|
| Visual material | https://ktgy.com/Work/the-gwen-a-luxury-collection-hotel/ | 아이보리·차콜 대비, 브론즈 세로 디테일 | 사진, 조형물, 호텔 브랜드 |
| Motion/interaction | https://motion.dev/docs/react-animation and https://motion.dev/docs/react-hover-animation | 순차 수치 등장, layout/hover/focus 피드백 | Motion+ 유료 컴포넌트, 데모 스타일 |
| Product structure | existing `/dashboard` and `/classes` | 기간, 동기화, 운영 큐, 권한 범위 | 현재 동일 카드/라임 중심 외형 |

## Tokens

- Font: Pretendard Variable 400/500/600/700; Archivo 500/600/700 for numbers and short labels.
- Text colors: ink `#24221F`, secondary `#6E685F`, inverse `#F7F1E7`.
- Surface colors: porcelain `#F4EFE6`, paper `#FFFCF6`, charcoal `#242421`, raised charcoal `#30302C`.
- Accent and semantic colors: bronze `#A97845`, dark bronze `#76502D`, success `#50705B`, warning `#A26632`, error `#A34D45`.
- Spacing steps: 4, 8, 12, 16, 24, 32, 48px.
- Radius: 4px controls, 6px panels, 8px floating surfaces.
- Border and shadow: `1px solid rgba(73,64,52,.16)`; shadow only for floating menu/dialog.
- Motion: 140ms feedback, 180ms selection, 220–320ms coordinated reveal.

## Screen priorities

1. PT 팀 매출과 신규·재등록 구성.
2. 오늘 수업과 지금 확인할 재등록 회원.
3. 트레이너별 회원·매출 및 실제 시트 유입 분류.

## Behavior that must remain unchanged

- Google Sheets는 읽기 전용이다.
- 트레이너는 Google 연결 없이 본인 범위만 본다.
- 일부 시트 실패가 정상 시트의 결과를 가리지 않는다.
- 실제 0과 미확인은 구분하며 원본에 없는 영업 분류를 만들지 않는다.

## Anti-template decisions

- Generic pattern being rejected: 동일 크기 KPI 카드와 장식용 배지로 채운 기본 관리자 템플릿.
- Project-specific replacement: PT 원장형 넓은 데이터 무대, 브론즈 수직 운영 레일, 합계에서 트레이너/시트 근거로 이어지는 연결형 구성.

## Responsive and motion contract

- Desktop media behavior: 외부 미디어 없이 데이터 자체를 주인공으로 두며 12열 중 PT 원장이 가장 넓은 영역을 차지한다.
- Mobile media behavior: PT 원장을 첫 항목으로 유지하고 보조 지표를 2열 요약, 표를 읽기 순서형 행으로 변환한다.
- Scroll reveal grammar: 첫 진입 한 번만 60ms stagger를 사용하고 반복 스크롤 페이드는 사용하지 않는다.
- Reduced-motion fallback: 모든 최종 값·차트·행을 즉시 보이고 상태 색과 텍스트 피드백은 유지한다.
- Text-clipping viewports: 390px 필수, 한국어 줄바꿈과 44px 조작 영역, 문서 가로 스크롤 0을 검증한다.

## Verification captures

- 1440×900 관리자 대시보드 첫 화면과 전체 흐름.
- 390×844 관리자/트레이너 첫 화면과 변환된 PT 원장·수업 행.
- 정상, 실제 0, 연결 미확인, 부분 실패 상태.
- 키보드 포커스, 트레이너 선택, 기간 갱신 및 reduced-motion 상태.
- 5–10초 순차 캡처로 PT 총액→분해→트레이너 행 모션을 확인한다.
