import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting pharmacy dummy data seed...');

  // Target specific business ID
  const targetCompanyId = 'cmndiqqkv00041cd8b51arwyo';
  
  // Get the company
  const company = await prisma.company.findUnique({
    where: { id: targetCompanyId }
  });

  if (!company) {
    console.error('❌ Company not found with ID:', targetCompanyId);
    return;
  }

  console.log('✅ Found company:', company.name, 'ID:', company.id);

  // Get or create a branch for this company
  let branch = await prisma.branch.findFirst({ where: { companyId: company.id } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: 'Main Branch',
        companyId: company.id,
        address: '123 Main Street, City, Country',
        phone: '+1234567890',
        email: 'main@pharmacy.com',
      },
    });
    console.log('✅ Created branch:', branch.name);
  }

  const branchId = branch.id;
  const companyId = company.id;

  // Create Categories - Medical and Non-Medical
  const categories = await prisma.category.createMany({
    data: [
      // Medical Categories
      { name: 'Antibiotics', description: 'Antibiotic medications for bacterial infections', type: 'MEDICAL', color: '#EF4444', branchId, companyId },
      { name: 'Painkillers', description: 'Pain relief medications', type: 'MEDICAL', color: '#F59E0B', branchId, companyId },
      { name: 'Vitamins', description: 'Vitamin supplements', type: 'MEDICAL', color: '#10B981', branchId, companyId },
      { name: 'Cardiovascular', description: 'Heart and blood pressure medications', type: 'MEDICAL', color: '#3B82F6', branchId, companyId },
      { name: 'Diabetes', description: 'Diabetes management medications', type: 'MEDICAL', color: '#8B5CF6', branchId, companyId },
      { name: 'Respiratory', description: 'Respiratory system medications', type: 'MEDICAL', color: '#EC4899', branchId, companyId },
      { name: 'Digestive', description: 'Digestive system medications', type: 'MEDICAL', color: '#14B8A6', branchId, companyId },
      { name: 'Skin Care', description: 'Dermatology products', type: 'MEDICAL', color: '#F97316', branchId, companyId },
      { name: 'Eye Care', description: 'Ophthalmology products', type: 'MEDICAL', color: '#6366F1', branchId, companyId },
      { name: 'Allergy', description: 'Allergy relief medications', type: 'MEDICAL', color: '#F43F5E', branchId, companyId },
      
      // Non-Medical Categories
      { name: 'Personal Care', description: 'Personal hygiene products', type: 'NON_MEDICAL', color: '#84CC16', branchId, companyId },
      { name: 'Baby Care', description: 'Baby products and accessories', type: 'NON_MEDICAL', color: '#06B6D4', branchId, companyId },
      { name: 'Beauty & Cosmetics', description: 'Beauty and cosmetic products', type: 'NON_MEDICAL', color: '#EC4899', branchId, companyId },
      { name: 'Health Devices', description: 'Health monitoring devices', type: 'NON_MEDICAL', color: '#8B5CF6', branchId, companyId },
      { name: 'First Aid', description: 'First aid supplies', type: 'NON_MEDICAL', color: '#F97316', branchId, companyId },
      { name: 'Nutritional Supplements', description: 'Protein and nutritional supplements', type: 'NON_MEDICAL', color: '#10B981', branchId, companyId },
      { name: 'Dental Care', description: 'Dental hygiene products', type: 'NON_MEDICAL', color: '#3B82F6', branchId, companyId },
      { name: 'General', description: 'General pharmacy items', type: 'GENERAL', color: '#6B7280', branchId, companyId },
    ],
  });
  console.log('✅ Created categories:', categories.count);

  const createdCategories = await prisma.category.findMany({ where: { branchId } });

  // Create Manufacturers
  const manufacturers = await prisma.manufacturer.createMany({
    data: [
      { name: 'Pfizer', description: 'Global pharmaceutical company', country: 'USA', website: 'https://www.pfizer.com', branchId, companyId },
      { name: 'GlaxoSmithKline', description: 'British pharmaceutical company', country: 'UK', website: 'https://www.gsk.com', branchId, companyId },
      { name: 'Novartis', description: 'Swiss pharmaceutical company', country: 'Switzerland', website: 'https://www.novartis.com', branchId, companyId },
      { name: 'Roche', description: 'Swiss healthcare company', country: 'Switzerland', website: 'https://www.roche.com', branchId, companyId },
      { name: 'Sanofi', description: 'French pharmaceutical company', country: 'France', website: 'https://www.sanofi.com', branchId, companyId },
      { name: 'Merck & Co', description: 'American pharmaceutical company', country: 'USA', website: 'https://www.merck.com', branchId, companyId },
      { name: 'Johnson & Johnson', description: 'American multinational corporation', country: 'USA', website: 'https://www.jnj.com', branchId, companyId },
      { name: 'AbbVie', description: 'American biopharmaceutical company', country: 'USA', website: 'https://www.abbvie.com', branchId, companyId },
      { name: 'AstraZeneca', description: 'British-Swedish pharmaceutical company', country: 'UK', website: 'https://www.astrazeneca.com', branchId, companyId },
      { name: 'Eli Lilly', description: 'American pharmaceutical company', country: 'USA', website: 'https://www.lilly.com', branchId, companyId },
    ],
  });
  console.log('✅ Created manufacturers:', manufacturers.count);

  const createdManufacturers = await prisma.manufacturer.findMany({ where: { branchId } });

  // Create Suppliers
  const suppliers = await prisma.supplier.createMany({
    data: [
      { name: 'MedSupply Co', contactPerson: 'John Smith', phone: '+1234567890', email: 'john@medsupply.com', address: '456 Supply St, City', manufacturerId: createdManufacturers[0].id, branchId, companyId },
      { name: 'PharmaDistributors', contactPerson: 'Jane Doe', phone: '+1234567891', email: 'jane@pharmadist.com', address: '789 Distributor Ave, City', manufacturerId: createdManufacturers[1].id, branchId, companyId },
      { name: 'HealthMeds Inc', contactPerson: 'Bob Johnson', phone: '+1234567892', email: 'bob@healthmeds.com', address: '321 Health Blvd, City', manufacturerId: createdManufacturers[2].id, branchId, companyId },
      { name: 'DrugWarehouse', contactPerson: 'Alice Williams', phone: '+1234567893', email: 'alice@drugwarehouse.com', address: '654 Warehouse Rd, City', manufacturerId: createdManufacturers[3].id, branchId, companyId },
      { name: 'MedicalEssentials', contactPerson: 'Charlie Brown', phone: '+1234567894', email: 'charlie@medessentials.com', address: '987 Essential Ln, City', manufacturerId: createdManufacturers[4].id, branchId, companyId },
    ],
  });
  console.log('✅ Created suppliers:', suppliers.count);

  const createdSuppliers = await prisma.supplier.findMany({ where: { branchId } });

  // Create Shelves
  const shelves = await prisma.shelf.createMany({
    data: [
      { name: 'Shelf A1', description: 'Antibiotics shelf', location: 'Room 1, Wall A', branchId, companyId },
      { name: 'Shelf A2', description: 'Painkillers shelf', location: 'Room 1, Wall A', branchId, companyId },
      { name: 'Shelf B1', description: 'Vitamins shelf', location: 'Room 1, Wall B', branchId, companyId },
      { name: 'Shelf B2', description: 'Cardiovascular shelf', location: 'Room 1, Wall B', branchId, companyId },
      { name: 'Shelf C1', description: 'Diabetes shelf', location: 'Room 2, Wall C', branchId, companyId },
      { name: 'Shelf C2', description: 'Respiratory shelf', location: 'Room 2, Wall C', branchId, companyId },
      { name: 'Shelf D1', description: 'Digestive shelf', location: 'Room 2, Wall D', branchId, companyId },
      { name: 'Shelf D2', description: 'Skin Care shelf', location: 'Room 2, Wall D', branchId, companyId },
      { name: 'Shelf E1', description: 'Eye Care shelf', location: 'Room 3, Wall E', branchId, companyId },
      { name: 'Shelf E2', description: 'General items shelf', location: 'Room 3, Wall E', branchId, companyId },
    ],
  });
  console.log('✅ Created shelves:', shelves.count);

  const createdShelves = await prisma.shelf.findMany({ where: { branchId } });

  // Create Products - Medical and Non-Medical
  const antibioticCategory = createdCategories.find(c => c.name === 'Antibiotics');
  const painkillerCategory = createdCategories.find(c => c.name === 'Painkillers');
  const vitaminCategory = createdCategories.find(c => c.name === 'Vitamins');
  const cardioCategory = createdCategories.find(c => c.name === 'Cardiovascular');
  const diabetesCategory = createdCategories.find(c => c.name === 'Diabetes');
  const respiratoryCategory = createdCategories.find(c => c.name === 'Respiratory');
  const digestiveCategory = createdCategories.find(c => c.name === 'Digestive');
  const skinCareCategory = createdCategories.find(c => c.name === 'Skin Care');
  const eyeCareCategory = createdCategories.find(c => c.name === 'Eye Care');
  const allergyCategory = createdCategories.find(c => c.name === 'Allergy');
  const personalCareCategory = createdCategories.find(c => c.name === 'Personal Care');
  const babyCareCategory = createdCategories.find(c => c.name === 'Baby Care');
  const beautyCategory = createdCategories.find(c => c.name === 'Beauty & Cosmetics');
  const healthDevicesCategory = createdCategories.find(c => c.name === 'Health Devices');
  const firstAidCategory = createdCategories.find(c => c.name === 'First Aid');
  const nutritionalCategory = createdCategories.find(c => c.name === 'Nutritional Supplements');
  const dentalCategory = createdCategories.find(c => c.name === 'Dental Care');
  const generalCategory = createdCategories.find(c => c.name === 'General');

  const products = await prisma.product.createMany({
    data: [
      // Medical - Antibiotics
      { name: 'Amoxicillin 500mg', description: 'Antibiotic for bacterial infections', formula: 'Amoxicillin Trihydrate', sku: 'AMOX-500', categoryId: antibioticCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 10, barcode: 'AMOX500001', requiresPrescription: true },
      { name: 'Azithromycin 250mg', description: 'Antibiotic for respiratory infections', formula: 'Azithromycin Dihydrate', sku: 'AZIT-250', categoryId: antibioticCategory!.id, branchId, companyId, minStock: 30, unitsPerPack: 6, barcode: 'AZIT250001', requiresPrescription: true },
      { name: 'Ciprofloxacin 500mg', description: 'Antibiotic for urinary tract infections', formula: 'Ciprofloxacin Hydrochloride', sku: 'CIPR-500', categoryId: antibioticCategory!.id, branchId, companyId, minStock: 40, unitsPerPack: 10, barcode: 'CIPR500001', requiresPrescription: true },
      { name: 'Doxycycline 100mg', description: 'Antibiotic for various infections', formula: 'Doxycycline Hyclate', sku: 'DOXY-100', categoryId: antibioticCategory!.id, branchId, companyId, minStock: 35, unitsPerPack: 10, barcode: 'DOXY100001', requiresPrescription: true },
      { name: 'Metronidazole 400mg', description: 'Antibiotic for anaerobic infections', formula: 'Metronidazole', sku: 'METR-400', categoryId: antibioticCategory!.id, branchId, companyId, minStock: 45, unitsPerPack: 10, barcode: 'METR400001', requiresPrescription: true },
      
      // Medical - Painkillers
      { name: 'Paracetamol 500mg', description: 'Pain reliever and fever reducer', formula: 'Paracetamol', sku: 'PARA-500', categoryId: painkillerCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 20, barcode: 'PARA500001', requiresPrescription: false },
      { name: 'Ibuprofen 400mg', description: 'NSAID for pain and inflammation', formula: 'Ibuprofen', sku: 'IBUP-400', categoryId: painkillerCategory!.id, branchId, companyId, minStock: 80, unitsPerPack: 15, barcode: 'IBUP400001', requiresPrescription: false },
      { name: 'Aspirin 75mg', description: 'Blood thinner and pain reliever', formula: 'Acetylsalicylic Acid', sku: 'ASPI-75', categoryId: painkillerCategory!.id, branchId, companyId, minStock: 90, unitsPerPack: 30, barcode: 'ASPI750001', requiresPrescription: false },
      { name: 'Naproxen 250mg', description: 'NSAID for pain relief', formula: 'Naproxen Sodium', sku: 'NAPR-250', categoryId: painkillerCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 10, barcode: 'NAPR250001', requiresPrescription: false },
      { name: 'Diclofenac 50mg', description: 'NSAID for pain and inflammation', formula: 'Diclofenac Sodium', sku: 'DICO-50', categoryId: painkillerCategory!.id, branchId, companyId, minStock: 55, unitsPerPack: 10, barcode: 'DICO500001', requiresPrescription: true },
      
      // Medical - Vitamins
      { name: 'Vitamin C 500mg', description: 'Vitamin C supplement', formula: 'Ascorbic Acid', sku: 'VITC-500', categoryId: vitaminCategory!.id, branchId, companyId, minStock: 150, unitsPerPack: 30, barcode: 'VITC500001', requiresPrescription: false },
      { name: 'Vitamin D3 1000IU', description: 'Vitamin D3 supplement', formula: 'Cholecalciferol', sku: 'VITD-1000', categoryId: vitaminCategory!.id, branchId, companyId, minStock: 120, unitsPerPack: 60, barcode: 'VITD1000001', requiresPrescription: false },
      { name: 'Vitamin B Complex', description: 'B vitamin supplement', formula: 'B-Complex', sku: 'VITB-COM', categoryId: vitaminCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 30, barcode: 'VITBCOM001', requiresPrescription: false },
      { name: 'Calcium + D3', description: 'Calcium and Vitamin D3 supplement', formula: 'Calcium Carbonate + Cholecalciferol', sku: 'CALD-600', categoryId: vitaminCategory!.id, branchId, companyId, minStock: 80, unitsPerPack: 30, barcode: 'CALD600001', requiresPrescription: false },
      { name: 'Iron Supplement', description: 'Iron supplement for anemia', formula: 'Ferrous Sulfate', sku: 'IRON-65', categoryId: vitaminCategory!.id, branchId, companyId, minStock: 70, unitsPerPack: 30, barcode: 'IRON650001', requiresPrescription: false },
      
      // Medical - Cardiovascular
      { name: 'Amlodipine 5mg', description: 'Calcium channel blocker for hypertension', formula: 'Amlodipine Besylate', sku: 'AMLO-5', categoryId: cardioCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 30, barcode: 'AMLO500001', requiresPrescription: true },
      { name: 'Lisinopril 10mg', description: 'ACE inhibitor for hypertension', formula: 'Lisinopril', sku: 'LISI-10', categoryId: cardioCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 30, barcode: 'LISI100001', requiresPrescription: true },
      { name: 'Metoprolol 50mg', description: 'Beta blocker for hypertension', formula: 'Metoprolol Tartrate', sku: 'METO-50', categoryId: cardioCategory!.id, branchId, companyId, minStock: 55, unitsPerPack: 30, barcode: 'METO500001', requiresPrescription: true },
      { name: 'Atorvastatin 20mg', description: 'Statin for cholesterol management', formula: 'Atorvastatin Calcium', sku: 'ATOR-20', categoryId: cardioCategory!.id, branchId, companyId, minStock: 45, unitsPerPack: 30, barcode: 'ATOR200001', requiresPrescription: true },
      { name: 'Losartan 50mg', description: 'ARB for hypertension', formula: 'Losartan Potassium', sku: 'LOSA-50', categoryId: cardioCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 30, barcode: 'LOSA500001', requiresPrescription: true },
      
      // Medical - Diabetes
      { name: 'Metformin 500mg', description: 'Biguanide for diabetes', formula: 'Metformin Hydrochloride', sku: 'METF-500', categoryId: diabetesCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 60, barcode: 'METF500001', requiresPrescription: true },
      { name: 'Insulin Glargine', description: 'Long-acting insulin', formula: 'Insulin Glargine', sku: 'INSU-GLA', categoryId: diabetesCategory!.id, branchId, companyId, minStock: 40, unitsPerPack: 5, barcode: 'INSUGLA001', requiresPrescription: true },
      { name: 'Sitagliptin 100mg', description: 'DPP-4 inhibitor for diabetes', formula: 'Sitagliptin Phosphate', sku: 'SITA-100', categoryId: diabetesCategory!.id, branchId, companyId, minStock: 35, unitsPerPack: 30, barcode: 'SITA100001', requiresPrescription: true },
      { name: 'Empagliflozin 10mg', description: 'SGLT2 inhibitor for diabetes', formula: 'Empagliflozin', sku: 'EMPA-10', categoryId: diabetesCategory!.id, branchId, companyId, minStock: 30, unitsPerPack: 30, barcode: 'EMPA100001', requiresPrescription: true },
      { name: 'Dapagliflozin 10mg', description: 'SGLT2 inhibitor for diabetes', formula: 'Dapagliflozin', sku: 'DAPA-10', categoryId: diabetesCategory!.id, branchId, companyId, minStock: 30, unitsPerPack: 30, barcode: 'DAPA100001', requiresPrescription: true },
      
      // Medical - Respiratory
      { name: 'Salbutamol Inhaler', description: 'Bronchodilator for asthma', formula: 'Salbutamol Sulfate', sku: 'SALB-INH', categoryId: respiratoryCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 1, barcode: 'SALBINH001', requiresPrescription: true },
      { name: 'Montelukast 10mg', description: 'Leukotriene receptor antagonist', formula: 'Montelukast Sodium', sku: 'MONT-10', categoryId: respiratoryCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 30, barcode: 'MONT100001', requiresPrescription: true },
      { name: 'Fluticasone Nasal Spray', description: 'Corticosteroid for allergies', formula: 'Fluticasone Propionate', sku: 'FLUT-NS', categoryId: respiratoryCategory!.id, branchId, companyId, minStock: 40, unitsPerPack: 1, barcode: 'FLUTNS001', requiresPrescription: true },
      { name: 'Budesonide 200mcg', description: 'Inhaled corticosteroid', formula: 'Budesonide', sku: 'BUDE-200', categoryId: respiratoryCategory!.id, branchId, companyId, minStock: 45, unitsPerPack: 1, barcode: 'BUDE200001', requiresPrescription: true },
      { name: 'Ipratropium Bromide', description: 'Bronchodilator for COPD', formula: 'Ipratropium Bromide', sku: 'IPRA-20', categoryId: respiratoryCategory!.id, branchId, companyId, minStock: 35, unitsPerPack: 1, barcode: 'IPRA20001', requiresPrescription: true },
      
      // Medical - Digestive
      { name: 'Omeprazole 20mg', description: 'Proton pump inhibitor for GERD', formula: 'Omeprazole', sku: 'OMEP-20', categoryId: digestiveCategory!.id, branchId, companyId, minStock: 80, unitsPerPack: 30, barcode: 'OMEP200001', requiresPrescription: false },
      { name: 'Pantoprazole 40mg', description: 'Proton pump inhibitor', formula: 'Pantoprazole Sodium', sku: 'PANT-40', categoryId: digestiveCategory!.id, branchId, companyId, minStock: 70, unitsPerPack: 30, barcode: 'PANT400001', requiresPrescription: false },
      { name: 'Loperamide 2mg', description: 'Antidiarrheal medication', formula: 'Loperamide Hydrochloride', sku: 'LOPE-2', categoryId: digestiveCategory!.id, branchId, companyId, minStock: 90, unitsPerPack: 10, barcode: 'LOPE20001', requiresPrescription: false },
      { name: 'Simethicone 125mg', description: 'Antigas medication', formula: 'Simethicone', sku: 'SIME-125', categoryId: digestiveCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 30, barcode: 'SIME125001', requiresPrescription: false },
      { name: 'Famotidine 20mg', description: 'H2 blocker for heartburn', formula: 'Famotidine', sku: 'FAMO-20', categoryId: digestiveCategory!.id, branchId, companyId, minStock: 75, unitsPerPack: 30, barcode: 'FAMO200001', requiresPrescription: false },
      
      // Medical - Skin Care
      { name: 'Mupirocin Ointment', description: 'Topical antibiotic for skin infections', formula: 'Mupirocin', sku: 'MUPI-2', categoryId: skinCareCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 1, barcode: 'MUPI2001', requiresPrescription: false },
      { name: 'Hydrocortisone Cream', description: 'Corticosteroid for skin inflammation', formula: 'Hydrocortisone', sku: 'HYDR-1', categoryId: skinCareCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 1, barcode: 'HYDR1001', requiresPrescription: false },
      { name: 'Clotrimazole Cream', description: 'Antifungal for skin', formula: 'Clotrimazole', sku: 'CLOT-1', categoryId: skinCareCategory!.id, branchId, companyId, minStock: 55, unitsPerPack: 1, barcode: 'CLOT1001', requiresPrescription: false },
      { name: 'Benzoyl Peroxide Gel', description: 'Acne treatment', formula: 'Benzoyl Peroxide', sku: 'BENZ-5', categoryId: skinCareCategory!.id, branchId, companyId, minStock: 45, unitsPerPack: 1, barcode: 'BENZ5001', requiresPrescription: false },
      { name: 'Miconazole Powder', description: 'Antifungal powder', formula: 'Miconazole Nitrate', sku: 'MICO-2', categoryId: skinCareCategory!.id, branchId, companyId, minStock: 40, unitsPerPack: 1, barcode: 'MICO2001', requiresPrescription: false },
      
      // Medical - Eye Care
      { name: 'Tobramycin Eye Drops', description: 'Antibiotic eye drops', formula: 'Tobramycin', sku: 'TOBR-0.3', categoryId: eyeCareCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 1, barcode: 'TOBR003001', requiresPrescription: false },
      { name: 'Artificial Tears', description: 'Lubricating eye drops', formula: 'Carboxymethylcellulose', sku: 'ARTE-0.5', categoryId: eyeCareCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 1, barcode: 'ARTE005001', requiresPrescription: false },
      { name: 'Cyclopentolate Eye Drops', description: 'Cycloplegic eye drops', formula: 'Cyclopentolate Hydrochloride', sku: 'CYCL-1', categoryId: eyeCareCategory!.id, branchId, companyId, minStock: 30, unitsPerPack: 1, barcode: 'CYCL1001', requiresPrescription: true },
      { name: 'Timolol Eye Drops', description: 'Beta blocker for glaucoma', formula: 'Timolol Maleate', sku: 'TIMO-0.5', categoryId: eyeCareCategory!.id, branchId, companyId, minStock: 40, unitsPerPack: 1, barcode: 'TIMO005001', requiresPrescription: true },
      { name: 'Chloramphenicol Eye Ointment', description: 'Antibiotic eye ointment', formula: 'Chloramphenicol', sku: 'CHLO-1', categoryId: eyeCareCategory!.id, branchId, companyId, minStock: 35, unitsPerPack: 1, barcode: 'CHLO1001', requiresPrescription: false },
      
      // Medical - Allergy
      { name: 'Cetirizine 10mg', description: 'Antihistamine for allergies', formula: 'Cetirizine Hydrochloride', sku: 'CETI-10', categoryId: allergyCategory!.id, branchId, companyId, minStock: 120, unitsPerPack: 30, barcode: 'CETI100001', requiresPrescription: false },
      { name: 'Loratadine 10mg', description: 'Antihistamine for allergies', formula: 'Loratadine', sku: 'LORA-10', categoryId: allergyCategory!.id, branchId, companyId, minStock: 110, unitsPerPack: 30, barcode: 'LORA100001', requiresPrescription: false },
      { name: 'Fexofenadine 180mg', description: 'Antihistamine for allergies', formula: 'Fexofenadine Hydrochloride', sku: 'FEXO-180', categoryId: allergyCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 30, barcode: 'FEXO180001', requiresPrescription: false },
      { name: 'Diphenhydramine 25mg', description: 'Antihistamine for allergies', formula: 'Diphenhydramine Hydrochloride', sku: 'DIPH-25', categoryId: allergyCategory!.id, branchId, companyId, minStock: 90, unitsPerPack: 100, barcode: 'DIPH250001', requiresPrescription: false },
      { name: 'Montelukast 5mg', description: 'Leukotriene receptor antagonist', formula: 'Montelukast Sodium', sku: 'MONT-5', categoryId: allergyCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 30, barcode: 'MONT50001', requiresPrescription: true },
      
      // Non-Medical - Personal Care
      { name: 'Hand Sanitizer 500ml', description: 'Alcohol-based hand sanitizer', formula: 'Ethanol 70%', sku: 'HANS-500', categoryId: personalCareCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 1, barcode: 'HANS500001', requiresPrescription: false },
      { name: 'Shampoo 200ml', description: 'Hair cleansing shampoo', formula: 'Sodium Lauryl Sulfate', sku: 'SHAM-200', categoryId: personalCareCategory!.id, branchId, companyId, minStock: 80, unitsPerPack: 1, barcode: 'SHAM200001', requiresPrescription: false },
      { name: 'Body Lotion 250ml', description: 'Moisturizing body lotion', formula: 'Glycerin', sku: 'BODY-250', categoryId: personalCareCategory!.id, branchId, companyId, minStock: 70, unitsPerPack: 1, barcode: 'BODY250001', requiresPrescription: false },
      { name: 'Toothpaste 100g', description: 'Fluoride toothpaste', formula: 'Sodium Fluoride', sku: 'TOOT-100', categoryId: personalCareCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 1, barcode: 'TOOT100001', requiresPrescription: false },
      { name: 'Deodorant 150ml', description: 'Antiperspirant deodorant', formula: 'Aluminum Chlorohydrate', sku: 'DEOD-150', categoryId: personalCareCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 1, barcode: 'DEOD150001', requiresPrescription: false },
      
      // Non-Medical - Baby Care
      { name: 'Baby Diapers Size M', description: 'Disposable diapers for babies', formula: 'Absorbent Polymer', sku: 'DIAP-M', categoryId: babyCareCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 1, barcode: 'DIAPM001', requiresPrescription: false },
      { name: 'Baby Wipes 80pcs', description: 'Wet wipes for babies', formula: 'Water + Glycerin', sku: 'WIPE-80', categoryId: babyCareCategory!.id, branchId, companyId, minStock: 80, unitsPerPack: 1, barcode: 'WIPE80001', requiresPrescription: false },
      { name: 'Baby Lotion 200ml', description: 'Moisturizing lotion for babies', formula: 'Natural Oils', sku: 'BABL-200', categoryId: babyCareCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 1, barcode: 'BABL200001', requiresPrescription: false },
      { name: 'Baby Shampoo 200ml', description: 'Tear-free shampoo for babies', formula: 'Gentle Cleansers', sku: 'BABS-200', categoryId: babyCareCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 1, barcode: 'BABS200001', requiresPrescription: false },
      { name: 'Baby Powder 100g', description: 'Talc-free baby powder', formula: 'Cornstarch', sku: 'BABP-100', categoryId: babyCareCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 1, barcode: 'BABP100001', requiresPrescription: false },
      
      // Non-Medical - Beauty & Cosmetics
      { name: 'Face Moisturizer 50ml', description: 'Daily face moisturizer', formula: 'Hyaluronic Acid', sku: 'FACM-50', categoryId: beautyCategory!.id, branchId, companyId, minStock: 40, unitsPerPack: 1, barcode: 'FACM50001', requiresPrescription: false },
      { name: 'Sunscreen SPF 50', description: 'Broad spectrum sunscreen', formula: 'Zinc Oxide', sku: 'SUNS-50', categoryId: beautyCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 1, barcode: 'SUNS50001', requiresPrescription: false },
      { name: 'Lip Balm 10g', description: 'Moisturizing lip balm', formula: 'Beeswax', sku: 'LIPB-10', categoryId: beautyCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 1, barcode: 'LIPB10001', requiresPrescription: false },
      { name: 'Face Wash 100ml', description: 'Cleansing face wash', formula: 'Salicylic Acid', sku: 'FACW-100', categoryId: beautyCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 1, barcode: 'FACW100001', requiresPrescription: false },
      { name: 'Body Wash 250ml', description: 'Moisturizing body wash', formula: 'Glycerin', sku: 'BODW-250', categoryId: beautyCategory!.id, branchId, companyId, minStock: 70, unitsPerPack: 1, barcode: 'BODW250001', requiresPrescription: false },
      
      // Non-Medical - Health Devices
      { name: 'Blood Pressure Monitor', description: 'Digital blood pressure monitor', formula: 'Electronic Device', sku: 'BPM-DIG', categoryId: healthDevicesCategory!.id, branchId, companyId, minStock: 20, unitsPerPack: 1, barcode: 'BPMDIG001', requiresPrescription: false },
      { name: 'Digital Thermometer', description: 'Digital thermometer for fever', formula: 'Electronic Device', sku: 'THER-DIG', categoryId: healthDevicesCategory!.id, branchId, companyId, minStock: 30, unitsPerPack: 1, barcode: 'THERDIG001', requiresPrescription: false },
      { name: 'Glucometer', description: 'Blood glucose monitoring device', formula: 'Electronic Device', sku: 'GLUC-MET', categoryId: healthDevicesCategory!.id, branchId, companyId, minStock: 25, unitsPerPack: 1, barcode: 'GLUCMET001', requiresPrescription: false },
      { name: 'Pulse Oximeter', description: 'Oxygen saturation monitor', formula: 'Electronic Device', sku: 'PULSE-OX', categoryId: healthDevicesCategory!.id, branchId, companyId, minStock: 25, unitsPerPack: 1, barcode: 'PULSEOX001', requiresPrescription: false },
      { name: 'Nebulizer Machine', description: 'Nebulizer for respiratory treatments', formula: 'Electronic Device', sku: 'NEBU-MAC', categoryId: healthDevicesCategory!.id, branchId, companyId, minStock: 15, unitsPerPack: 1, barcode: 'NEBUMAC001', requiresPrescription: false },
      
      // Non-Medical - First Aid
      { name: 'Bandage Pack', description: 'Assorted bandages', formula: 'Sterile Gauze', sku: 'BAND-PACK', categoryId: firstAidCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 1, barcode: 'BANDPACK001', requiresPrescription: false },
      { name: 'Antiseptic Solution 100ml', description: 'Antiseptic for wound cleaning', formula: 'Povidone Iodine', sku: 'ANTI-100', categoryId: firstAidCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 1, barcode: 'ANTI100001', requiresPrescription: false },
      { name: 'Cotton Roll 500g', description: 'Absorbent cotton roll', formula: 'Absorbent Cotton', sku: 'COTT-500', categoryId: firstAidCategory!.id, branchId, companyId, minStock: 80, unitsPerPack: 1, barcode: 'COTT500001', requiresPrescription: false },
      { name: 'Gauze Pads 10x10', description: 'Sterile gauze pads', formula: 'Sterile Gauze', sku: 'GAUZ-10', categoryId: firstAidCategory!.id, branchId, companyId, minStock: 70, unitsPerPack: 1, barcode: 'GAUZ10001', requiresPrescription: false },
      { name: 'Medical Tape 2.5cm', description: 'Adhesive medical tape', formula: 'Adhesive Fabric', sku: 'TAPE-2.5', categoryId: firstAidCategory!.id, branchId, companyId, minStock: 90, unitsPerPack: 1, barcode: 'TAPE25001', requiresPrescription: false },
      
      // Non-Medical - Nutritional Supplements
      { name: 'Whey Protein 1kg', description: 'Whey protein powder', formula: 'Whey Protein Isolate', sku: 'WHEY-1KG', categoryId: nutritionalCategory!.id, branchId, companyId, minStock: 40, unitsPerPack: 1, barcode: 'WHEY1KG001', requiresPrescription: false },
      { name: 'Creatine Monohydrate 500g', description: 'Creatine supplement', formula: 'Creatine Monohydrate', sku: 'CREA-500', categoryId: nutritionalCategory!.id, branchId, companyId, minStock: 35, unitsPerPack: 1, barcode: 'CREA500001', requiresPrescription: false },
      { name: 'Omega-3 Fish Oil', description: 'Omega-3 fatty acids', formula: 'Fish Oil', sku: 'OMEG-3', categoryId: nutritionalCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 1, barcode: 'OMEG3001', requiresPrescription: false },
      { name: 'Multivitamin Tablets', description: 'Complete multivitamin supplement', formula: 'Multivitamin Complex', sku: 'MULT-TAB', categoryId: nutritionalCategory!.id, branchId, companyId, minStock: 80, unitsPerPack: 1, barcode: 'MULTTAB001', requiresPrescription: false },
      { name: 'Protein Bars Box', description: 'High protein snack bars', formula: 'Whey Protein', sku: 'PROB-BOX', categoryId: nutritionalCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 1, barcode: 'PROBBOX001', requiresPrescription: false },
      
      // Non-Medical - Dental Care
      { name: 'Dental Floss 50m', description: 'Waxed dental floss', formula: 'PTFE Coated', sku: 'FLOS-50', categoryId: dentalCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 1, barcode: 'FLOS50001', requiresPrescription: false },
      { name: 'Mouthwash 250ml', description: 'Antiseptic mouthwash', formula: 'Chlorhexidine', sku: 'MOUT-250', categoryId: dentalCategory!.id, branchId, companyId, minStock: 70, unitsPerPack: 1, barcode: 'MOUT250001', requiresPrescription: false },
      { name: 'Toothbrush Medium', description: 'Medium bristle toothbrush', formula: 'Nylon Bristles', sku: 'TOBR-MED', categoryId: dentalCategory!.id, branchId, companyId, minStock: 120, unitsPerPack: 1, barcode: 'TOBRMED001', requiresPrescription: false },
      { name: 'Interdental Brushes', description: 'Interdental cleaning brushes', formula: 'Nylon Bristles', sku: 'INTD-BRUSH', categoryId: dentalCategory!.id, branchId, companyId, minStock: 80, unitsPerPack: 1, barcode: 'INTDBRUSH001', requiresPrescription: false },
      { name: 'Tongue Cleaner', description: 'Stainless steel tongue cleaner', formula: 'Stainless Steel', sku: 'TONG-CLEAN', categoryId: dentalCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 1, barcode: 'TONGCLEAN001', requiresPrescription: false },
      
      // General Items
      { name: 'Disposable Gloves', description: 'Latex disposable gloves', formula: 'Latex', sku: 'GLOV-DISP', categoryId: generalCategory!.id, branchId, companyId, minStock: 200, unitsPerPack: 1, barcode: 'GLOVDISP001', requiresPrescription: false },
      { name: 'Face Masks 50pcs', description: 'Disposable face masks', formula: 'Non-woven Fabric', sku: 'MASK-50', categoryId: generalCategory!.id, branchId, companyId, minStock: 100, unitsPerPack: 1, barcode: 'MASK50001', requiresPrescription: false },
      { name: 'Surgical Caps', description: 'Disposable surgical caps', formula: 'Non-woven Fabric', sku: 'CAP-SURG', categoryId: generalCategory!.id, branchId, companyId, minStock: 80, unitsPerPack: 1, barcode: 'CAPSURG001', requiresPrescription: false },
      { name: 'Medical Apron', description: 'Disposable medical apron', formula: 'PE Film', sku: 'APRON-MED', categoryId: generalCategory!.id, branchId, companyId, minStock: 60, unitsPerPack: 1, barcode: 'APRONMED001', requiresPrescription: false },
      { name: 'Biohazard Bags', description: 'Medical waste disposal bags', formula: 'HDPE', sku: 'BIOH-BAG', categoryId: generalCategory!.id, branchId, companyId, minStock: 50, unitsPerPack: 1, barcode: 'BIOHBAG001', requiresPrescription: false },
    ],
  });
  console.log('✅ Created products:', products.count);

  const createdProducts = await prisma.product.findMany({ where: { branchId } });

  // Create Batches
  const today = new Date();
  const batches = await prisma.batch.createMany({
    data: createdProducts.map((product, index) => {
      const supplier = createdSuppliers[index % createdSuppliers.length];
      const shelf = createdShelves[index % createdShelves.length];
      const productionDate = new Date(today.getTime() - Math.random() * 365 * 24 * 60 * 60 * 1000);
      const expireDate = new Date(productionDate.getTime() + (365 + Math.random() * 365) * 24 * 60 * 60 * 1000);
      
      return {
        batchNo: `BATCH-${Date.now()}-${index}`,
        productId: product.id,
        branchId,
        companyId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        totalBoxes: Math.floor(10 + Math.random() * 50),
        unitsPerBox: Math.floor(10 + Math.random() * 50),
        quantity: Math.floor(100 + Math.random() * 500),
        purchasePrice: parseFloat((Math.random() * 50 + 5).toFixed(2)),
        sellingPrice: parseFloat((Math.random() * 100 + 10).toFixed(2)),
        expireDate,
        productionDate,
        shelfId: shelf.id,
        shelfName: shelf.name,
        barcode: product.barcode,
      };
    }),
  });
  console.log('✅ Created batches:', batches.count);

  console.log('🎉 Pharmacy dummy data seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
