// Display-only normalization. The YAML files remain the source of truth.
export function normalizeCoffee(record) {
  const components = record.blend_components || [];
  const unique = values => [...new Set(values.filter(Boolean))];
  const countries = unique(components.length ? components.map(c => c.country) : [record.origin.country]);
  const varieties = unique(components.length ? components.flatMap(c => c.varieties) : record.coffee_details.varieties);
  const processes = unique(components.length ? components.map(c => c.process) : [record.coffee_details.process]);
  return {
    id: record.id,
    name: record.coffee.name || 'Unnamed coffee',
    roaster: record.coffee.roaster || 'Roaster not recorded',
    roastDate: record.coffee.roast_date,
    status: record.inventory.status,
    statusDate: record.inventory.status_date,
    country: countries.join(' / ') || null,
    countries,
    varieties,
    process: processes.join(' / ') || null,
    tastingNotes: record.coffee_details.tasting_notes,
    ratings: record.ratings,
    personalNotes: record.personal_notes,
    isBlend: components.length > 0,
    blendComponents: components,
  };
}
