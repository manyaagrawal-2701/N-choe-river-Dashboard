$ErrorActionPreference = 'Stop'

function Fix-Text {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ''
    }

    $fixed = $Text.Trim()
    $fixed = $fixed.Replace([string][char]194, '')
    $fixed = $fixed -replace ([regex]::Escape([string][char]8211)), '-'
    $fixed = $fixed -replace '\s+', ' '
    return $fixed.Trim()
}

function Parse-ExcelCoordinates {
    param([string]$WorkbookPath)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($WorkbookPath)

    function Get-EntryText {
        param([string]$Path)

        $entry = $zip.Entries | Where-Object { $_.FullName -eq $Path }
        if (-not $entry) {
            throw "Missing workbook entry: $Path"
        }

        $reader = New-Object System.IO.StreamReader($entry.Open())
        try {
            return $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }

    $sharedXml = [xml](Get-EntryText 'xl/sharedStrings.xml')
    $sharedStrings = @()
    foreach ($si in $sharedXml.sst.si) {
        if ($si.t) {
            $sharedStrings += [string]$si.t
        }
        elseif ($si.r) {
            $sharedStrings += (($si.r | ForEach-Object { $_.t.'#text' }) -join '')
        }
        else {
            $sharedStrings += ''
        }
    }

    $sheetXml = [xml](Get-EntryText 'xl/worksheets/sheet1.xml')
    $rows = @()

    foreach ($row in $sheetXml.worksheet.sheetData.row) {
        $values = [ordered]@{}

        foreach ($cell in $row.c) {
            $ref = [string]$cell.r
            $col = ($ref -replace '\d', '')

            if ($cell.t -eq 's') {
                $value = $sharedStrings[[int]$cell.v]
            }
            elseif ($cell.t -eq 'inlineStr') {
                $value = [string]$cell.is.t
            }
            else {
                $value = [string]$cell.v
            }

            $values[$col] = $value
        }

        $rows += [pscustomobject]$values
    }

    $zip.Dispose()

    $coordinates = @{}
    foreach ($row in $rows | Select-Object -Skip 1) {
        $fileName = [System.IO.Path]::GetFileName([string]$row.A)
        if ([string]::IsNullOrWhiteSpace($fileName)) {
            continue
        }

        $lat = 0.0
        $lng = 0.0
        if (-not [double]::TryParse([string]$row.B, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$lat)) {
            continue
        }
        if (-not [double]::TryParse([string]$row.C, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$lng)) {
            continue
        }

        $coordinates[$fileName] = @{
            latitude = $lat
            longitude = $lng
        }
    }

    $manualCoordinates = @{
        'CPCB -2020 STATIONCODE 2047.csv' = @{
            latitude = 30.721836
            longitude = 76.731728
        }
        'CPCB-2018-ENTRY.csv' = @{
            latitude = 30.7382
            longitude = 76.75595
        }
        'GreenTribunal_2024_NCP06_-_N-choe_before_confluence_with_Ghaggar.csv' = @{
            latitude = 30.303183
            longitude = 76.635388
        }
        'Professor_Final_2024_2025_S1_N-CHOE.csv' = @{
            latitude = 30.748991
            longitude = 76.785329
        }
        'Professor_2024_2025_S2_Attawa_Choa.csv' = @{
            latitude = 30.68988
            longitude = 76.73774
        }
        'Professor_2024_2025_S3_Attawa_Choa_Sec._67.csv' = @{
            latitude = 30.67996
            longitude = 76.72966
        }
    }

    foreach ($fileName in $manualCoordinates.Keys) {
        $coordinates[$fileName] = $manualCoordinates[$fileName]
    }

    return $coordinates
}

function Get-MonthIndex {
    param([string]$Month)

    $monthLookup = @{
        Jan = 1; January = 1
        Feb = 2; February = 2
        Mar = 3; March = 3
        Apr = 4; April = 4
        May = 5
        Jun = 6; June = 6
        Jul = 7; July = 7
        Aug = 8; August = 8
        Sep = 9; Sept = 9; September = 9
        Oct = 10; October = 10
        Nov = 11; November = 11
        Dec = 12; December = 12
    }

    $clean = Fix-Text $Month
    if ($monthLookup.ContainsKey($clean)) {
        return $monthLookup[$clean]
    }

    return 0
}

function Convert-ToNumber {
    param([string]$RawValue)

    $clean = (Fix-Text $RawValue) -replace ',', ''
    if ([string]::IsNullOrWhiteSpace($clean)) {
        return $null
    }

    if ($clean -match '^([0-9]+(?:\.[0-9]+)?)x10\^([0-9]+)$') {
        return [double]$matches[1] * [math]::Pow(10, [int]$matches[2])
    }

    $number = 0.0
    if ([double]::TryParse($clean, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
        return $number
    }

    return $null
}

function Get-DisplayLocation {
    param(
        [string]$FileName,
        [string]$RawLocation
    )

    $known = @{
        'CPCB-2018-ENTRY.csv' = 'Entry Point'
        'CPCB-2018-EXIT.csv' = 'Exit of Chandigarh Sector 53'
        'CPCB-2021-EXIT.csv' = 'Exit of Chandigarh Sector 53'
        'CPCB-2023-EXIT-RECONVERTED.csv' = 'Exit of Chandigarh Sector 53'
        'CPCB -2020 STATIONCODE 2047.csv' = 'Exit of Chandigarh Sector 53'
        'CPCB-2018-DIGGIAN.csv' = 'Diggian'
        'CPCB-2020-DIGGIAN-COMPACT.csv' = 'Diggian'
        'CPCB-2018-3BRD.csv' = '3BRD'
        'CPCB-2020-3BRD-COMPACT.csv' = '3BRD'
        'Professor_Final_2024_2025_S1_N-CHOE.csv' = 'N-CHOE (Leisure Valley Park, Chandigarh)'
        'Professor_2024_2025_S2_Attawa_Choa.csv' = 'Attawa Choa (Leisure Valley Garden, Mohali)'
        'Professor_2024_2025_S3_Attawa_Choa_Sec._67.csv' = 'Attawa Choa Sec. 67'
    }

    $location = Fix-Text $RawLocation
    if (-not [string]::IsNullOrWhiteSpace($location)) {
        $location = $location -replace 'parK', 'Park'
        return $location
    }

    if ($known.ContainsKey($FileName)) {
        return $known[$FileName]
    }

    $name = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $name = $name -replace '[_-]+', ' '
    $name = $name -replace '\s+', ' '
    return (Fix-Text $name)
}

function Get-LocationGroup {
    param([string]$DisplayLocation)

    $clean = (Fix-Text $DisplayLocation).ToLowerInvariant()
    $clean = $clean -replace '[^a-z0-9]+', ' '
    $clean = $clean.Trim()

    switch -Regex ($clean) {
        'exit of chandigarh sector 53|sector 53' { return 'Exit of Chandigarh Sector 53' }
        '^3brd$' { return '3BRD' }
        '^diggian$' { return 'Diggian' }
        '^entry point$' { return 'Entry Point' }
        'station code 2047' { return 'CPCB Station Code 2047' }
        'n choe.*leisure valley' { return 'N-CHOE (Leisure Valley Park, Chandigarh)' }
        'attawa choa sec 67' { return 'Attawa Choa Sec. 67' }
        'attawa choa.*mohali' { return 'Attawa Choa (Leisure Valley Garden, Mohali)' }
        default { return $DisplayLocation }
    }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$coordinateMap = Parse-ExcelCoordinates -WorkbookPath (Join-Path $root 'lat_long.xlsx')
$csvFiles = Get-ChildItem -Path $root -Filter '*.csv' | Sort-Object Name
$records = New-Object System.Collections.Generic.List[object]
$locations = @{}

foreach ($file in $csvFiles) {
    $rows = Import-Csv -Path $file.FullName
    $coord = $coordinateMap[$file.Name]

    foreach ($row in $rows) {
        $year = 0
        $rowYear = Fix-Text $row.Year
        if (-not [int]::TryParse($rowYear, [ref]$year)) {
            $yearMatch = [regex]::Match($file.Name, '20\d{2}')
            if ($yearMatch.Success) {
                $year = [int]$yearMatch.Value
            }
        }

        $month = Fix-Text $row.Month
        $monthIndex = Get-MonthIndex $month
        $displayLocation = Get-DisplayLocation -FileName $file.Name -RawLocation $row.Location
        $locationGroup = Get-LocationGroup $displayLocation
        $parameter = Fix-Text $row.Parameter
        $unit = Fix-Text $row.Unit
        $source = Fix-Text $row.'Data Source'
        $rawValue = Fix-Text $row.Value
        $numericValue = Convert-ToNumber $rawValue
        $dateLabel = if ($monthIndex -gt 0) { "$month $year" } else { [string]$year }

        $records.Add([ordered]@{
            fileName = $file.Name
            location = $displayLocation
            locationGroup = $locationGroup
            parameter = $parameter
            unit = $unit
            month = $month
            monthIndex = $monthIndex
            year = $year
            dateLabel = $dateLabel
            sortKey = ($year * 100 + $monthIndex)
            rawValue = $rawValue
            numericValue = $numericValue
            source = $source
            latitude = if ($coord) { [math]::Round($coord.latitude, 6) } else { $null }
            longitude = if ($coord) { [math]::Round($coord.longitude, 6) } else { $null }
            hasCoordinates = [bool]$coord
        })

        if (-not $locations.ContainsKey($locationGroup)) {
            $locations[$locationGroup] = [ordered]@{
                id = $locationGroup.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
                name = $locationGroup
                latitude = if ($coord) { [math]::Round($coord.latitude, 6) } else { $null }
                longitude = if ($coord) { [math]::Round($coord.longitude, 6) } else { $null }
                hasCoordinates = [bool]$coord
                sources = @($file.Name)
            }
        }
        else {
            $existingSources = @($locations[$locationGroup].sources)
            if ($existingSources -notcontains $file.Name) {
                $locations[$locationGroup].sources = $existingSources + $file.Name
            }
        }
    }
}

$data = [ordered]@{
    generatedAt = (Get-Date).ToString('s')
    summary = [ordered]@{
        recordCount = $records.Count
        mappedLocationCount = (@($locations.Values | Where-Object { $_.hasCoordinates })).Count
        unmappedLocationCount = (@($locations.Values | Where-Object { -not $_.hasCoordinates })).Count
    }
    locations = @($locations.Values | Sort-Object name)
    records = @($records | Sort-Object locationGroup, parameter, sortKey, fileName)
}

$json = $data | ConvertTo-Json -Depth 6
$output = "window.NCHOE_DASHBOARD_DATA = $json;"
Set-Content -Path (Join-Path $root 'dashboard-data.js') -Value $output -Encoding UTF8
Write-Host "Created dashboard-data.js with $($records.Count) records."
