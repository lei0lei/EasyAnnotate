export type MockProject = {
  id: string
  name: string
  path: string
  updatedLabel: string
}

export const mockProjects: MockProject[] = [
  {
    id: "retail-counter",
    name: "Retail Counter v2",
    path: "~/Projects/retail-counter",
    updatedLabel: "2 小时前",
  },
  {
    id: "parking-seg",
    name: "Parking Segmentation",
    path: "~/Projects/parking",
    updatedLabel: "昨天",
  },
  {
    id: "warehouse-inv",
    name: "Warehouse Inventory",
    path: "~/Projects/warehouse",
    updatedLabel: "3 天前",
  },
]

export function getMockProject(id: string): MockProject | undefined {
  return mockProjects.find((p) => p.id === id)
}
